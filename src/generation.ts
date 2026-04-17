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
import { ApiError } from "./errors.js";

export interface StartGenerationOptions {
  compositionId: string;
  description: string;
}

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
  const { compositionId, description } = options;

  const response = await fetch(`${baseUrl}/api/v1/compositions/${compositionId}/generate`, {
    method: "POST",
    headers: {
      "Underscore-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ description }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(
      errorBody.error || `Failed to start generation: ${response.status}`,
      response.status
    );
  }

  const data = (await response.json()) as { jobId?: string; streamUrl?: string };
  if (!data.jobId || !data.streamUrl) {
    throw new ApiError("Malformed start-generation response (missing jobId or streamUrl)", 500);
  }

  return { jobId: data.jobId, streamUrl: data.streamUrl };
}

/**
 * Subscribe to a generation stream by URL. Browser-only (uses EventSource).
 *
 * Accepts either an absolute URL or the relative `streamUrl` returned by
 * `startGeneration`. When relative, `baseUrl` is prepended. No API key is
 * required -- the stream is protected by the unguessable `jobId`
 * embedded in the URL.
 */
export async function* subscribeToGeneration(
  streamUrlOrPath: string,
  baseUrl?: string
): AsyncGenerator<GenerationEvent> {
  if (typeof EventSource === "undefined") {
    throw new Error(
      "EventSource is not available in this environment. " +
        "Call subscribeToGeneration from a browser, and run startGeneration on your server."
    );
  }

  const url = /^https?:\/\//i.test(streamUrlOrPath)
    ? streamUrlOrPath
    : `${baseUrl ?? ""}${streamUrlOrPath}`;

  const events: GenerationEvent[] = [];
  let resolveNext: ((value: IteratorResult<GenerationEvent>) => void) | null = null;
  let done = false;
  let error: Error | null = null;

  const eventSource = new EventSource(url);

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
    if (!done) {
      error = new Error("SSE connection error");
      done = true;
      eventSource.close();
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve({ value: { type: "error", error: "Connection lost" }, done: false });
      }
    }
  };

  try {
    while (!done || events.length > 0) {
      if (events.length > 0) {
        yield events.shift()!;
      } else if (!done) {
        const result = await new Promise<IteratorResult<GenerationEvent>>((resolve) => {
          resolveNext = resolve;
        });
        if (!result.done) {
          yield result.value;
        }
      }
    }
  } finally {
    eventSource.close();
  }

  if (error) {
    yield { type: "error", error: (error as Error).message };
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

  yield* subscribeToGeneration(start.streamUrl, baseUrl);
}

interface BackendEvent {
  type: string;
  content?: string;
  phase?: string;
  synthName?: string;
  technical?: string;
  friendly?: string;
  reason?: string;
}

/*
 * Map server SSE event types to the SDK's minimal GenerationEvent union.
 * The server's stream.ts always normalizes `llm.*` events to these short
 * names before emitting to clients, so we do not need to handle `llm.*`
 * variants here. Unmapped events are surfaced as `{ type: "raw" }` so
 * power users can introspect the full protocol without SDK changes.
 */
export function mapBackendEvent(data: BackendEvent): GenerationEvent | null {
  switch (data.type) {
    case "thinking":
      return { type: "thinking", content: data.content };

    case "phase_change":
      return { type: "progress", content: data.phase };

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

    case "declined":
      return { type: "error", error: data.reason || data.content || "Request declined" };

    default:
      return { type: "raw", raw: data as unknown as Record<string, unknown> };
  }
}
