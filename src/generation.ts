/**
 * Generation streaming client.
 *
 * Handles SSE connections for synth generation, yielding events as they arrive.
 */

import type { GenerationEvent } from "./types.js";

interface GenerationOptions {
  compositionId: string;
  description: string;
}

/**
 * Generator that yields events from a synth generation stream.
 */
export async function* streamGeneration(
  baseUrl: string,
  apiKey: string,
  options: GenerationOptions
): AsyncGenerator<GenerationEvent> {
  const { compositionId, description } = options;

  // Start the generation job
  const startResponse = await fetch(`${baseUrl}/api/v1/compositions/${compositionId}/generate`, {
    method: "POST",
    headers: {
      "Underscore-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ description }),
  });

  if (!startResponse.ok) {
    const error = await startResponse.json().catch(() => ({ error: "Unknown error" }));
    yield { type: "error", error: error.error || `Generation failed: ${startResponse.status}` };
    return;
  }

  const { streamUrl } = await startResponse.json();

  // Connect to SSE stream
  const events: GenerationEvent[] = [];
  let resolveNext: ((value: IteratorResult<GenerationEvent>) => void) | null = null;
  let done = false;
  let error: Error | null = null;

  const eventSource = new EventSource(`${baseUrl}${streamUrl}`);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as BackendEvent;

      // Map backend events to SDK events
      const event = mapBackendEvent(data);
      if (!event) return;

      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve({ value: event, done: false });
      } else {
        events.push(event);
      }

      // Check for terminal events
      if (event.type === "ready" || event.type === "error") {
        done = true;
        eventSource.close();
      }
    } catch (_err) {
      // Silently ignore malformed SSE data - not critical
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

interface BackendEvent {
  type: string;
  content?: string;
  phase?: string;
  synthName?: string;
  technical?: string;
  friendly?: string;
  reason?: string;
}

/**
 * Map backend event types to SDK event types.
 * The stream endpoint normalizes event names for the frontend.
 */
function mapBackendEvent(data: BackendEvent): GenerationEvent | null {
  switch (data.type) {
    // Thinking events
    case "thinking":
    case "llm.thinking.chunk":
      return { type: "thinking", content: data.content };

    // Progress/phase events
    case "phase_change":
    case "llm.phase_change":
      return { type: "progress", content: data.phase };

    // Code streaming events
    case "code":
    case "llm.code.chunk":
      return { type: "code", content: data.content };

    // Synth created (intermediate, contains metadata)
    case "synth_created":
      return { 
        type: "progress", 
        content: `Created synth: ${data.synthName}` 
      };

    // Completion events
    case "complete":
      return { type: "ready", synthName: data.synthName };

    // Error/failure events
    case "error":
      return { 
        type: "error", 
        error: data.technical || data.friendly || "Unknown error" 
      };

    case "declined":
      return { type: "error", error: data.reason || data.content || "Request declined" };

    default:
      return null;
  }
}
