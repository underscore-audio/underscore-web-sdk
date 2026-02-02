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
      const client = new ApiClient("us_test_key");
      expect(client["baseUrl"]).toBe("https://underscore.audio");
    });

    it("accepts custom base URL", () => {
      const client = new ApiClient("us_test_key", "https://custom.api.com");
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
        }),
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
      await expect(client.listSynths("cmp_invalid")).rejects.toThrow(
        "Composition not found",
      );
    });

    it("handles network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const client = new ApiClient("us_test_key");
      await expect(client.listSynths("cmp_123")).rejects.toThrow(
        "Network error",
      );
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
        expect.anything(),
      );
      expect(metadata).toEqual(mockMetadata);
    });
  });

  describe("getSynthdefUrl", () => {
    it("returns correct URL", () => {
      const client = new ApiClient("us_test_key");
      const url = client.getSynthdefUrl("cmp_123", "my_synth");
      expect(url).toBe(
        "https://underscore.audio/api/v1/compositions/cmp_123/synths/my_synth/synthdef",
      );
    });

    it("uses custom base URL", () => {
      const client = new ApiClient("us_test_key", "https://custom.api.com");
      const url = client.getSynthdefUrl("cmp_123", "my_synth");
      expect(url).toBe(
        "https://custom.api.com/api/v1/compositions/cmp_123/synths/my_synth/synthdef",
      );
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
        }),
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
        "Failed to fetch synthdef: 404",
      );
    });
  });
});
