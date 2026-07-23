/**
 * Tests for the API client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiClient } from "./client.js";

describe("ApiClient", () => {
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
    it("uses default base URL", () => {
      const client = new ApiClient("us_pub_test_key");
      expect(client["baseUrl"]).toBe("https://underscore.audio");
    });

    it("accepts custom base URL", () => {
      const client = new ApiClient("us_sec_test_key", "https://custom.api.com");
      expect(client["baseUrl"]).toBe("https://custom.api.com");
    });
  });

  describe("listSynths", () => {
    it("fetches synths for a composition", async () => {
      const mockSynths = [
        {
          name: "synth1",
          description: "First synth",
          params: [],
          createdAt: "2024-01-01",
        },
        {
          name: "synth2",
          description: "Second synth",
          params: [],
          createdAt: "2024-01-02",
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ synths: mockSynths }),
      });

      const client = new ApiClient("us_test_key");
      const synths = await client.listSynths("cmp_123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://underscore.audio/api/v1/compositions/cmp_123/synths",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Underscore-API-Key": "us_test_key",
            "Content-Type": "application/json",
          }),
        })
      );
      expect(synths).toEqual(mockSynths);
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Composition not found" }),
      });

      const client = new ApiClient("us_test_key");
      await expect(client.listSynths("cmp_invalid")).rejects.toThrow("Composition not found");
    });

    it("handles network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const client = new ApiClient("us_test_key");
      await expect(client.listSynths("cmp_123")).rejects.toThrow("Network error");
    });
  });

  describe("getSynth", () => {
    it("fetches synth metadata", async () => {
      const mockMetadata = {
        name: "warm_pad",
        description: "A warm pad sound",
        params: [
          {
            name: "amp",
            type: "amp",
            default: 0.5,
            min: 0,
            max: 1,
            description: "Volume",
          },
        ],
        createdAt: "2024-01-01",
        synthdefUrl: "/api/v1/compositions/cmp_123/synths/warm_pad/synthdef",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMetadata),
      });

      const client = new ApiClient("us_test_key");
      const metadata = await client.getSynth("cmp_123", "warm_pad");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://underscore.audio/api/v1/compositions/cmp_123/synths/warm_pad",
        expect.anything()
      );
      expect(metadata).toEqual(mockMetadata);
    });
  });

  describe("fetchSynthdef", () => {
    it("fetches binary synthdef data", async () => {
      const mockData = new ArrayBuffer(100);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockData),
      });

      const client = new ApiClient("us_test_key");
      const data = await client.fetchSynthdef("cmp_123", "my_synth");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://underscore.audio/api/v1/compositions/cmp_123/synths/my_synth/synthdef",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Underscore-API-Key": "us_test_key",
          }),
        })
      );
      expect(data).toBe(mockData);
    });

    it("throws on fetch error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const client = new ApiClient("us_test_key");
      await expect(client.fetchSynthdef("cmp_123", "invalid")).rejects.toThrow(
        "Failed to fetch synthdef: 404"
      );
    });
  });

  describe("listPrograms", () => {
    const mockProgram = {
      name: "night_ledger",
      title: "Night Ledger",
      description: "A nocturnal piece",
      bpm: 92,
      beatsPerBar: 4,
      durationBeats: 256,
      durationSec: 166.96,
      sections: [{ name: "intro", beat: 0 }],
      synthdefs: ["nl_pad", "nl_bass"],
      createdAt: "2026-07-01T00:00:00.000Z",
      manifestUrl: "/api/v1/compositions/cmp_123/programs/night_ledger",
    };

    it("fetches and validates program summaries", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ programs: [mockProgram] }),
      });

      const client = new ApiClient("us_test_key");
      const programs = await client.listPrograms("cmp_123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://underscore.audio/api/v1/compositions/cmp_123/programs",
        expect.objectContaining({
          headers: expect.objectContaining({ "Underscore-API-Key": "us_test_key" }),
        })
      );
      expect(programs).toEqual([mockProgram]);
    });

    it("throws ValidationError on a malformed summary", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ programs: [{ name: "broken" }] }),
      });

      const client = new ApiClient("us_test_key");
      await expect(client.listPrograms("cmp_123")).rejects.toThrow("Invalid API response");
    });
  });

  describe("getProgramManifest", () => {
    const mockManifest = {
      format: 1,
      name: "night_ledger",
      title: "Night Ledger",
      description: "A nocturnal piece",
      bpm: 92,
      beatsPerBar: 4,
      durationBeats: 256,
      synthdefs: ["nl_pad"],
      buses: [],
      sections: [],
      setup: [{ cmd: "/g_new", args: [10, 0, 0] }],
      events: [{ beat: 0, cmd: "/s_new", args: ["nl_pad", 100, 1, 10] }],
    };

    it("fetches and validates the manifest", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      const client = new ApiClient("us_test_key");
      const manifest = await client.getProgramManifest("cmp_123", "night_ledger");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://underscore.audio/api/v1/compositions/cmp_123/programs/night_ledger",
        expect.anything()
      );
      expect(manifest).toEqual(mockManifest);
    });

    /*
     * The format literal is the version gate: a future manifest format
     * must fail loudly here instead of being replayed with semantics
     * this SDK does not implement.
     */
    it("rejects a manifest from an unknown future format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockManifest, format: 2 }),
      });

      const client = new ApiClient("us_test_key");
      await expect(client.getProgramManifest("cmp_123", "night_ledger")).rejects.toThrow(
        "Invalid API response"
      );
    });
  });

  describe("fetchProgramSynthdef", () => {
    it("fetches binary synthdef data for a program def", async () => {
      const mockData = new ArrayBuffer(64);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockData),
      });

      const client = new ApiClient("us_test_key");
      const data = await client.fetchProgramSynthdef("cmp_123", "night_ledger", "nl_pad");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://underscore.audio/api/v1/compositions/cmp_123/programs/night_ledger/synthdefs/nl_pad",
        expect.objectContaining({
          headers: expect.objectContaining({ "Underscore-API-Key": "us_test_key" }),
        })
      );
      expect(data).toBe(mockData);
    });

    it("throws on fetch error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const client = new ApiClient("us_test_key");
      await expect(
        client.fetchProgramSynthdef("cmp_123", "night_ledger", "missing")
      ).rejects.toThrow("Failed to fetch program synthdef: 404");
    });
  });
});
