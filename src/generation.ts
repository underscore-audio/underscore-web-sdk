/**
 * Generation client.
 *
 * Split into two primitives so each half runs in its correct environment:
 *
 *   1. `startGeneration` uses `fetch` only and is safe to call from Node
 *      servers that hold a **secret** key (`us_sec_...`). It kicks off a
 *      generation job and returns the unguessable `jobId` and `streamUrl`.
 *
 *   2. `subscribeToGeneration` opens an SSE connection via `EventSource`
 *      (browser-only). It takes the `streamUrl` from step 1 and yields
 *      events as they arrive. No auth header is required because the
 *      server-side stream endpoint treats `jobId` as a capability token.
 *
 * The legacy `streamGeneration` is kept as a thin wrapper for trusted
 * environments (e.g. a Node CLI using the same process for both halves,
 * or an Electron app). Third-party browser apps MUST use the
 * backend-proxy pattern: customer server calls `startGeneration`, then
 * hands the `streamUrl` to the browser which calls `subscribeToGeneration`.
 */

import type { GenerationEvent } from "./types.js";
import type { GenerateRequest } from "./generated/api-types.js";
import { ApiError } from "./errors.js";
import { GenerateResponseSchema } from "./schemas.js";

export interface StartGenerationOptions {
  compositionId: string;
  description: string;
  /**
   * Speed-vs-richness dial for the generation job.
   *
   *   - `"fast"`: lowest latency, small dense synth. For latency-sensitive
   *     callers (e.g. generating during gameplay).
   *   - `"balanced"`: the default single-shot behavior.
   *   - `"rich"`: maximum musical richness at the cost of generation time.
   *
   * Omit to preserve the historical default (same as `"balanced"`).
   */
  complexity?: GenerateRequest["complexity"];
  /**
   * Explicit model override for callers that want to pin a specific
   * model. Valid values are defined by the backend and change as models
   * are added or retired; prefer `complexity`, which is stable across
   * model generations.
   */
  model?: GenerateRequest["model"];
}

/**
 * Generation tuning knobs shared by the `Underscore` client methods.
 * Subset of {@link StartGenerationOptions} without the addressing fields.
 */
export type GenerationOptions = Pick<StartGenerationOptions, "complexity" | "model">;

export interface StartGenerationResult {
  jobId: string;
  streamUrl: string;
}

/**
 * Kick off a generation job. Server-side only.
 *
 * Requires a **secret** key (`us_sec_...`). The API rejects publishable
 * keys on this endpoint. Uses `fetch` only so it works in Node and any
 * runtime that provides a global `fetch`.
 *
 * The returned `streamUrl` is relative (starts with `/api/stream/...`).
 * Callers can pass the full URL (prefixed with `baseUrl`) to the browser.
 */
export async function startGeneration(
  baseUrl: string,
  apiKey: string,
  options: StartGenerationOptions
): Promise<StartGenerationResult> {
  const { compositionId, description, complexity, model } = options;

  /*
   * JSON.stringify drops undefined-valued keys, so omitted knobs never
   * reach the wire and the server applies its historical single-shot
   * default. The API rejects unknown body keys, so this omission (rather
   * than sending nulls) is load-bearing.
   */
  const response = await fetch(`${baseUrl}/api/v1/compositions/${compositionId}/generate`, {
    method: "POST",
    headers: {
      "Underscore-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ description, complexity, model }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(
      errorBody.error || `Failed to start generation: ${response.status}`,
      response.status
    );
  }

  const data = await response.json();
  const result = GenerateResponseSchema.safeParse(data);
  if (!result.success) {
    throw new ApiError("Malformed start-generation response (missing jobId or streamUrl)", 500);
  }

  return result.data;
}

/**
 * Options for {@link subscribeToGeneration}.
 *
 * Held as an options bag (rather than positional arguments) so future
 * additions -- timeouts, custom EventSource factories, log hooks --
 * never have to grow the signature.
 */
export interface SubscribeToGenerationOptions {
  /**
   * Base URL to prepend when `streamUrlOrPath` is a relative path. If
   * omitted, the path is used as-is (which only works when it is already
   * absolute).
   */
  baseUrl?: string;
  /**
   * AbortSignal. Aborting closes the underlying SSE socket and ends
   * the generator. Safe to abort before iteration starts; the
   * generator will finish immediately on the first `next()`.
   */
  signal?: AbortSignal;
}

/**
 * Subscribe to a generation stream by URL. Browser-only (uses EventSource).
 *
 * Accepts either an absolute URL or the relative `streamUrl` returned by
 * `startGeneration`. When relative, `options.baseUrl` is prepended. No
 * API key is required -- the stream is protected by the unguessable
 * `jobId` embedded in the URL.
 *
 * @param streamUrlOrPath Absolute or relative stream URL.
 * @param options Optional bag: `baseUrl` to resolve relative paths,
 *                `signal` to cancel.
 */
export async function* subscribeToGeneration(
  streamUrlOrPath: string,
  options: SubscribeToGenerationOptions = {}
): AsyncGenerator<GenerationEvent> {
  if (typeof EventSource === "undefined") {
    throw new Error(
      "EventSource is not available in this environment. " +
        "Call subscribeToGeneration from a browser, and run startGeneration on your server."
    );
  }

  const { baseUrl, signal } = options;

  /*
   * Short-circuit before allocating an EventSource if the caller
   * already aborted. Otherwise we would open the SSE socket only to
   * immediately close it -- harmless but wasteful in tight cleanup
   * paths (e.g. an effect that subscribes and immediately tears down
   * on dependency change).
   */
  if (signal?.aborted) {
    return;
  }

  const url = /^https?:\/\//i.test(streamUrlOrPath)
    ? streamUrlOrPath
    : `${baseUrl ?? ""}${streamUrlOrPath}`;

  const events: GenerationEvent[] = [];
  let resolveNext: ((value: IteratorResult<GenerationEvent, undefined>) => void) | null = null;
  let done = false;

  const eventSource = new EventSource(url);

  /*
   * Wire the abort signal through so a consumer cleanup (effect
   * teardown, navigation, watchdog timeout) closes the SSE socket
   * immediately. Without this, the EventSource stays open and the
   * generator stays suspended on `await resolveNext`, leaking an
   * HTTP/1.1 connection slot per stuck subscription.
   */
  const onAbort = (): void => {
    if (done) return;
    done = true;
    eventSource.close();
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve({ value: undefined, done: true });
    }
  };
  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as BackendEvent;
      const event = mapBackendEvent(data);
      if (!event) return;

      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve({ value: event, done: false });
      } else {
        events.push(event);
      }

      if (event.type === "ready" || event.type === "error") {
        done = true;
        eventSource.close();
      }
    } catch {
      /* ignore malformed SSE data; not actionable */
    }
  };

  eventSource.onerror = () => {
    if (done) return;
    /*
     * Funnel transport errors through the same event queue the
     * normal message path uses. The generator's drain loop sees the
     * synthetic `error` event on its next `next()` call and the
     * caller's for-await receives it like any other event, no extra
     * post-loop branch needed.
     */
    const errEvent: GenerationEvent = { type: "error", error: "Connection lost" };
    done = true;
    eventSource.close();
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve({ value: errEvent, done: false });
    } else {
      events.push(errEvent);
    }
  };

  try {
    while (!done || events.length > 0) {
      if (events.length > 0) {
        yield events.shift()!;
      } else if (!done) {
        const result = await new Promise<IteratorResult<GenerationEvent, undefined>>((resolve) => {
          resolveNext = resolve;
        });
        if (!result.done) {
          yield result.value;
        }
      }
    }
  } finally {
    eventSource.close();
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * Legacy combined flow. Convenience wrapper that chains `startGeneration`
 * and `subscribeToGeneration` in the same process.
 *
 * Only usable from environments that have BOTH a network path able to use
 * a secret key AND `EventSource` (e.g. a local dev page, an Electron app,
 * or a Node process with an EventSource polyfill installed). Third-party
 * browser apps should use the backend-proxy pattern instead -- call
 * `startGeneration` from your server, then hand the `streamUrl` to the
 * browser which calls `subscribeToGeneration`.
 */
export async function* streamGeneration(
  baseUrl: string,
  apiKey: string,
  options: StartGenerationOptions
): AsyncGenerator<GenerationEvent> {
  let start: StartGenerationResult;
  try {
    start = await startGeneration(baseUrl, apiKey, options);
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err.message : "Failed to start generation",
    };
    return;
  }

  yield* subscribeToGeneration(start.streamUrl, { baseUrl });
}

interface BackendEvent {
  type: string;
  content?: string;
  phase?: string;
  synthName?: string;
  technical?: string;
  friendly?: string;
  reason?: string;
  attempt?: number;
}

/*
 * Map server SSE event types to the SDK's minimal GenerationEvent union.
 * The backend SSE handler always normalizes `llm.*` events to these short
 * names before emitting to clients, so we do not need to handle `llm.*`
 * variants here. Unmapped events are surfaced as `{ type: "raw" }` so
 * power users can introspect the full protocol without SDK changes.
 *
 * The former `declined` event no longer exists server-side; declined
 * requests now arrive as regular `error` events, so there is no branch
 * for it here.
 */
export function mapBackendEvent(data: BackendEvent): GenerationEvent | null {
  switch (data.type) {
    case "thinking":
      return { type: "thinking", content: data.content };

    case "phase_change":
      return { type: "progress", content: data.phase };

    case "status":
      return { type: "progress", content: data.content };

    case "repair_started":
      return {
        type: "progress",
        content:
          data.attempt !== undefined
            ? `Repairing synth (attempt ${data.attempt})`
            : "Repairing synth",
      };

    case "code":
      return { type: "code", content: data.content };

    case "synth_created":
      return {
        type: "progress",
        content: `Created synth: ${data.synthName}`,
      };

    case "complete":
      return { type: "ready", synthName: data.synthName };

    case "error":
      return {
        type: "error",
        error: data.technical || data.friendly || "Unknown error",
      };

    default:
      return { type: "raw", raw: data as unknown as Record<string, unknown> };
  }
}
