/**
 * Tests for the main Underscore class.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Underscore, Synth } from "./index.js";
import { MockEventSource } from "../test/setup.js";

/*
 * Small helper: the SDK opens the EventSource synchronously inside the
 * generator body on the first `next()` call, but the body runs as a
 * microtask. One event-loop tick is enough to observe the constructed
 * instance on MockEventSource.instances.
 */
const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Underscore", () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("constructor", () => {
    it("creates client with minimal config", () => {
      const client = new Underscore({
        apiKey: "us_test_key",
      });
      expect(client).toBeInstanceOf(Underscore);
    });

    it("creates client with full config", () => {
      const client = new Underscore({
        apiKey: "us_test_key",
        baseUrl: "https://custom.api.com",
        wasmBaseUrl: "/assets/supersonic/",
        workerBaseUrl: "/assets/supersonic/workers/",
      });
      expect(client).toBeInstanceOf(Underscore);
    });
  });

  describe("isInitialized()", () => {
    it("returns false before init", () => {
      const client = new Underscore({ apiKey: "us_test_key" });
      expect(client.isInitialized()).toBe(false);
    });
  });

  describe("listSynths()", () => {
    it("fetches synths from API", async () => {
      const mockSynths = [
        { name: "synth1", description: "First", params: [], createdAt: "2024-01-01" },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ synths: mockSynths }),
      });

      const client = new Underscore({ apiKey: "us_test_key" });
      const synths = await client.listSynths("cmp_123");

      expect(synths).toEqual(mockSynths);
    });
  });

  describe("getSynth()", () => {
    it("fetches synth metadata from API", async () => {
      const mockMetadata = {
        name: "warm_pad",
        description: "A warm pad",
        params: [],
        createdAt: "2024-01-01",
        synthdefUrl: "/api/v1/compositions/cmp_123/synths/warm_pad/synthdef",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMetadata),
      });

      const client = new Underscore({ apiKey: "us_test_key" });
      const metadata = await client.getSynth("cmp_123", "warm_pad");

      expect(metadata).toEqual(mockMetadata);
    });
  });

  describe("loadSynth()", () => {
    it("loads synth by name", async () => {
      const mockMetadata = {
        name: "warm_pad",
        description: "A warm pad",
        params: [{ name: "amp", type: "amp", default: 0.5, min: 0, max: 1, description: "Vol" }],
        createdAt: "2024-01-01",
        synthdefUrl: "/api/v1/compositions/cmp_123/synths/warm_pad/synthdef",
      };

      // Mock getSynth
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMetadata),
      });

      // Mock fetchSynthdef
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      const client = new Underscore({ apiKey: "us_test_key" });
      const synth = await client.loadSynth("cmp_123", "warm_pad");

      expect(synth.name).toBe("warm_pad");
      expect(synth.loaded).toBe(true);
    });

    it("loads latest synth when name not provided", async () => {
      const mockSynths = [
        { name: "old_synth", description: "Old", params: [], createdAt: "2024-01-01" },
        { name: "latest_synth", description: "Latest", params: [], createdAt: "2024-01-02" },
      ];

      // Mock listSynths
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ synths: mockSynths }),
      });

      // Mock getSynth for latest_synth
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "latest_synth",
            description: "Latest",
            params: [],
            createdAt: "2024-01-02",
            synthdefUrl: "/api/v1/compositions/cmp_123/synths/latest_synth/synthdef",
          }),
      });

      // Mock fetchSynthdef
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      const client = new Underscore({ apiKey: "us_test_key" });
      const synth = await client.loadSynth("cmp_123");

      // Verify that the latest synth was loaded
      expect(synth.name).toBe("latest_synth");
      expect(synth.loaded).toBe(true);

      // Verify that getSynth was called with the latest synth name
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("latest_synth"),
        expect.anything()
      );
    });

    it("throws when composition has no synths", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ synths: [] }),
      });

      const client = new Underscore({ apiKey: "us_test_key" });
      await expect(client.loadSynth("cmp_123")).rejects.toThrow("No synths found");
    });
  });

  describe("audioContext", () => {
    it("returns null before init", () => {
      const client = new Underscore({ apiKey: "us_test_key" });
      expect(client.audioContext).toBeNull();
    });
  });

  describe("subscribeToGeneration() auto-load behavior", () => {
    beforeEach(() => {
      MockEventSource.resetInstances();
    });

    /*
     * Documented contract (JSDoc on Underscore#subscribeToGeneration):
     * when the caller provides `compositionId`, a terminal `ready` event
     * triggers loadSynth and the result is attached as `event.synth` so
     * the caller can `await event.synth.play()` without a second round-trip.
     */
    it("attaches a loaded Synth to the ready event when compositionId is given", async () => {
      const metadata = {
        name: "warm_pad",
        description: "A warm pad",
        params: [],
        createdAt: "2024-01-01",
        synthdefUrl: "/api/v1/compositions/cmp_123/synths/warm_pad/synthdef",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(metadata),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)),
      });

      const client = new Underscore({ apiKey: "us_pub_test" });
      const iter = client.subscribeToGeneration("/api/stream/cmp_123/job_abc", "cmp_123");
      const firstPromise = iter.next();
      await nextTick();

      const es = MockEventSource.instances.at(-1)!;
      es._simulateMessage(JSON.stringify({ type: "complete", synthName: "warm_pad" }));

      const { value, done } = await firstPromise;
      expect(done).toBe(false);
      expect(value?.type).toBe("ready");
      expect(value?.synth).toBeInstanceOf(Synth);
      expect(value?.synth?.name).toBe("warm_pad");
    });

    /*
     * Documented contract: if loadSynth throws during auto-load, the
     * iterator yields a synthetic `{ type: "error" }` event instead of
     * propagating the exception. This lets callers handle every failure
     * mode inside their for-await loop.
     */
    it("yields an error event instead of throwing when auto-load fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Server exploded" }),
      });

      const client = new Underscore({ apiKey: "us_pub_test" });
      const iter = client.subscribeToGeneration("/api/stream/cmp_123/job_abc", "cmp_123");
      const firstPromise = iter.next();
      await nextTick();

      const es = MockEventSource.instances.at(-1)!;
      es._simulateMessage(JSON.stringify({ type: "complete", synthName: "warm_pad" }));

      const { value, done } = await firstPromise;
      expect(done).toBe(false);
      expect(value?.type).toBe("error");
      expect(typeof value?.error).toBe("string");
      expect(value?.synth).toBeUndefined();
    });
  });

  describe("startGeneration()", () => {
    it("kicks off a job and returns jobId + streamUrl", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            jobId: "job_abc",
            streamUrl: "/api/stream/cmp_123/job_abc",
          }),
      });

      const client = new Underscore({
        apiKey: "us_sec_test_key",
        baseUrl: "https://api.test.com",
      });
      const result = await client.startGeneration("cmp_123", "warm pad");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.test.com/api/v1/compositions/cmp_123/generate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ description: "warm pad" }),
        })
      );
      expect(result.jobId).toBe("job_abc");
      expect(result.streamUrl).toBe("/api/stream/cmp_123/job_abc");
    });
  });
});

describe("exports", () => {
  it("exports Synth class", () => {
    expect(Synth).toBeDefined();
    expect(typeof Synth).toBe("function");
  });

  it("exports Underscore as default", async () => {
    const module = await import("./index.js");
    expect(module.default).toBe(Underscore);
  });
});
