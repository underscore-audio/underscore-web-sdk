/**
 * Tests for the generation streaming client.
 *
 * `subscribeToGeneration` relies on `EventSource` and is exercised via
 * integration tests. Here we cover `startGeneration` (Node-safe, fetch
 * only), `streamGeneration`'s fallthrough behavior, and `mapBackendEvent`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError } from "./errors.js";

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
        json: () => Promise.resolve({ jobId: "job_abc" /* no streamUrl */ }),
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
  });
});
