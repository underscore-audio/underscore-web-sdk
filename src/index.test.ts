/**
 * Tests for the main Underscore class.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Underscore, Synth } from "./index.js";

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
        json: () => Promise.resolve({
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
