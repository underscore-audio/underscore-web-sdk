/**
 * Tests for the generation streaming client.
 *
 * `subscribeToGeneration` relies on `EventSource` and is exercised via
 * integration tests. Here we cover `startGeneration` (Node-safe, fetch
 * only), `streamGeneration`'s fallthrough behavior, and `mapBackendEvent`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "./errors.js";
import { MockEventSource } from "../test/setup.js";

/*
 * Drain a microtask hop. The subscribeToGeneration body runs as a
 * microtask after the consumer's first `.next()`; one tick is enough
 * to let it construct the EventSource so MockEventSource.instances
 * reflects the live socket.
 */
const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("generation", () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("startGeneration", () => {
    it("returns jobId and streamUrl on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jobId: "job_abc",
            streamUrl: "/api/stream/cmp_123/job_abc",
          }),
      });

      const { startGeneration } = await import("./generation.js");

      const result = await startGeneration("https://api.test.com", "us_sec_test_key", {
        compositionId: "cmp_123",
        description: "Make a warm pad",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test.com/api/v1/compositions/cmp_123/generate",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Underscore-API-Key": "us_sec_test_key",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ description: "Make a warm pad" }),
        })
      );
      expect(result.jobId).toBe("job_abc");
      expect(result.streamUrl).toBe("/api/stream/cmp_123/job_abc");
    });

    it("includes complexity and model in the request body when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jobId: "job_abc",
            streamUrl: "/api/stream/cmp_123/job_abc",
          }),
      });

      const { startGeneration } = await import("./generation.js");

      await startGeneration("https://api.test.com", "us_sec_test_key", {
        compositionId: "cmp_123",
        description: "Make a warm pad",
        complexity: "fast",
        model: "some-model-id",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test.com/api/v1/compositions/cmp_123/generate",
        expect.objectContaining({
          body: JSON.stringify({
            description: "Make a warm pad",
            complexity: "fast",
            model: "some-model-id",
          }),
        })
      );
    });

    /*
     * The API rejects unknown/null body keys (additionalProperties:
     * false), so a partially-specified options bag must serialize only
     * the keys the caller actually set. The exact-string assertion pins
     * that `model` is absent, not null.
     */
    it("omits unset knobs from the request body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jobId: "job_abc",
            streamUrl: "/api/stream/cmp_123/job_abc",
          }),
      });

      const { startGeneration } = await import("./generation.js");

      await startGeneration("https://api.test.com", "us_sec_test_key", {
        compositionId: "cmp_123",
        description: "Make a warm pad",
        complexity: "rich",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test.com/api/v1/compositions/cmp_123/generate",
        expect.objectContaining({
          body: JSON.stringify({ description: "Make a warm pad", complexity: "rich" }),
        })
      );
    });

    it("throws ApiError with server message on HTTP failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "Secret key required for this operation" }),
      });

      const { startGeneration } = await import("./generation.js");

      await expect(
        startGeneration("https://api.test.com", "us_pub_test_key", {
          compositionId: "cmp_123",
          description: "Test",
        })
      ).rejects.toBeInstanceOf(ApiError);
    });

    it("throws ApiError when server response is malformed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: "not-a-job-id", streamUrl: "/not-a-stream" }),
      });

      const { startGeneration } = await import("./generation.js");

      await expect(
        startGeneration("https://api.test.com", "us_sec_test_key", {
          compositionId: "cmp_123",
          description: "Test",
        })
      ).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe("streamGeneration (legacy wrapper)", () => {
    it("yields error event when startGeneration fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Invalid API key" }),
      });

      const { streamGeneration } = await import("./generation.js");

      const generator = streamGeneration("https://api.test.com", "us_test_key", {
        compositionId: "cmp_123",
        description: "Make a warm pad",
      });

      const result = await generator.next();

      expect(result.value).toEqual({ type: "error", error: "Invalid API key" });
    });
  });

  describe("subscribeToGeneration environment guard", () => {
    /*
     * Documented contract: when called from an environment that has no
     * EventSource global, the SDK must fail with a message that points
     * the caller at the correct fix (run startGeneration on the server).
     * We don't pin the exact wording -- we assert on the two load-bearing
     * concepts so the message can be rephrased without breaking the test.
     */
    it("throws a helpful error when EventSource is unavailable", async () => {
      const original = globalThis.EventSource;
      vi.stubGlobal("EventSource", undefined);
      try {
        const { subscribeToGeneration } = await import("./generation.js");
        const iter = subscribeToGeneration("https://api.test.com/api/stream/cmp/job");
        await expect(iter.next()).rejects.toThrow(
          /startGeneration.*server|server.*startGeneration/s
        );
      } finally {
        vi.stubGlobal("EventSource", original);
      }
    });
  });

  describe("subscribeToGeneration early-abort short-circuit", () => {
    /*
     * Documented contract: a signal that is already aborted at call
     * time short-circuits the generator without allocating an
     * EventSource. Worth pinning explicitly because the wrong place to
     * check `signal.aborted` (after `new EventSource(url)`) opens a
     * socket only to immediately close it -- harmless but a real cost
     * in tight effect-cleanup loops.
     */
    it("does not construct an EventSource when the signal is already aborted", async () => {
      const ctorSpy = vi.fn();
      class TrackingEventSource {
        url: string;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        close = vi.fn();
        addEventListener = vi.fn();
        removeEventListener = vi.fn();
        constructor(url: string) {
          ctorSpy(url);
          this.url = url;
        }
      }
      const original = globalThis.EventSource;
      vi.stubGlobal("EventSource", TrackingEventSource);
      try {
        const controller = new AbortController();
        controller.abort();

        const { subscribeToGeneration } = await import("./generation.js");
        const iter = subscribeToGeneration("https://api.test.com/api/stream/cmp/job", {
          signal: controller.signal,
        });

        const first = await iter.next();
        expect(first.done).toBe(true);
        expect(ctorSpy).not.toHaveBeenCalled();
      } finally {
        vi.stubGlobal("EventSource", original);
      }
    });
  });

  describe("subscribeToGeneration mid-stream abort", () => {
    /*
     * Documented contract: aborting the signal AFTER the EventSource
     * is open closes the socket and terminates the async iterator
     * cleanly. This is the most common cancel path consumers use
     * (effect teardown, navigation, watchdog timeout) and is distinct
     * from the early-abort short-circuit -- a regression here would
     * leak an SSE socket per stuck subscription with no error visible
     * to the caller.
     */
    it("closes the EventSource and ends the iterator when the signal aborts after the stream opens", async () => {
      MockEventSource.resetInstances();
      const controller = new AbortController();

      const { subscribeToGeneration } = await import("./generation.js");
      const iter = subscribeToGeneration("https://api.test.com/api/stream/cmp/job", {
        signal: controller.signal,
      });

      const pending = iter.next();
      await nextTick();

      const es = MockEventSource.instances.at(-1)!;
      expect(es.readyState).not.toBe(MockEventSource.CLOSED);

      controller.abort();

      const result = await pending;
      expect(result.done).toBe(true);
      expect(es.readyState).toBe(MockEventSource.CLOSED);

      /*
       * After a clean abort the iterator stays terminated -- no spurious
       * follow-on yields and no thrown error. A consumer's for-await
       * loop will exit normally.
       */
      const followup = await iter.next();
      expect(followup.done).toBe(true);
    });
  });

  describe("subscribeToGeneration SSE error funnel", () => {
    /*
     * Documented contract: a transport error on the EventSource is
     * surfaced to the consumer as an in-order `{ type: "error" }` event
     * on the async iterator, NOT as a thrown exception and NOT as an
     * out-of-order yield after the stream loop has already drained.
     * The previous implementation funneled errors through a post-loop
     * `if (error) yield`; this pins the queue-based replacement so a
     * regression to the post-loop pattern (which reorders errors after
     * any buffered messages) is caught.
     */
    it("yields a typed error event in-order when the EventSource raises a transport error", async () => {
      MockEventSource.resetInstances();

      const { subscribeToGeneration } = await import("./generation.js");
      const iter = subscribeToGeneration("https://api.test.com/api/stream/cmp/job");

      const pending = iter.next();
      await nextTick();

      const es = MockEventSource.instances.at(-1)!;
      es._simulateError();

      const result = await pending;
      expect(result.done).toBe(false);
      expect(result.value).toEqual({ type: "error", error: "Connection lost" });

      /*
       * After the synthetic error the iterator terminates without
       * yielding further events. The contract is one error event then
       * done -- consumers must not see a duplicate or a trailing
       * undefined value.
       */
      const next = await iter.next();
      expect(next.done).toBe(true);
    });
  });

  describe("mapBackendEvent", () => {
    it("maps thinking events", async () => {
      const { mapBackendEvent } = await import("./generation.js");
      expect(mapBackendEvent({ type: "thinking", content: "reasoning..." })).toEqual({
        type: "thinking",
        content: "reasoning...",
      });
    });

    it("maps phase_change to progress", async () => {
      const { mapBackendEvent } = await import("./generation.js");
      expect(mapBackendEvent({ type: "phase_change", phase: "compiling" })).toEqual({
        type: "progress",
        content: "compiling",
      });
    });

    it("maps status to progress", async () => {
      const { mapBackendEvent } = await import("./generation.js");
      expect(
        mapBackendEvent({ type: "status", content: "compilation failed, retrying (2/3)..." })
      ).toEqual({
        type: "progress",
        content: "compilation failed, retrying (2/3)...",
      });
    });

    it("maps repair_started to progress with the attempt number", async () => {
      const { mapBackendEvent } = await import("./generation.js");
      expect(mapBackendEvent({ type: "repair_started", attempt: 2 })).toEqual({
        type: "progress",
        content: "Repairing synth (attempt 2)",
      });
    });

    it("maps repair_started without an attempt to a generic label", async () => {
      const { mapBackendEvent } = await import("./generation.js");
      expect(mapBackendEvent({ type: "repair_started" })).toEqual({
        type: "progress",
        content: "Repairing synth",
      });
    });

    it("maps complete to ready", async () => {
      const { mapBackendEvent } = await import("./generation.js");
      expect(mapBackendEvent({ type: "complete", synthName: "warm_pad" })).toEqual({
        type: "ready",
        synthName: "warm_pad",
      });
    });

    it("maps error preferring technical over friendly", async () => {
      const { mapBackendEvent } = await import("./generation.js");
      expect(
        mapBackendEvent({
          type: "error",
          technical: "timeout",
          friendly: "something went wrong",
        })
      ).toEqual({ type: "error", error: "timeout" });
    });

    it("falls back to raw event for unmapped types", async () => {
      const { mapBackendEvent } = await import("./generation.js");
      const unmapped = { type: "model_ready", content: "gpt-5" };
      const result = mapBackendEvent(unmapped);
      expect(result?.type).toBe("raw");
      expect(result?.raw).toEqual(unmapped);
    });

    /*
     * The backend removed the `declined` SSE event (declines now arrive
     * as `error`), so the SDK dropped its mapping. Pin the fallthrough
     * so nobody reintroduces a first-class branch for a dead event type.
     */
    it("treats the retired declined type as an unmapped raw event", async () => {
      const { mapBackendEvent } = await import("./generation.js");
      const retired = { type: "declined", reason: "off-topic" };
      const result = mapBackendEvent(retired);
      expect(result?.type).toBe("raw");
      expect(result?.raw).toEqual(retired);
    });
  });
});
