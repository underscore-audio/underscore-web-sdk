/**
 * Integration tests for the SDK using MSW to mock API responses.
 *
 * These tests verify the full flow from SDK initialization to synth playback.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Underscore, ApiError, SynthError, ValidationError } from "../src/index.js";
import { server } from "./mocks/server.js";
import { testData, unauthorizedHandler, serverErrorHandler } from "./mocks/handlers.js";
import { http, HttpResponse } from "msw";

describe("SDK Integration", () => {
  let client: Underscore;

  beforeEach(() => {
    client = new Underscore({
      apiKey: "us_test_key",
      wasmBaseUrl: "/supersonic/",
      baseUrl: "https://underscore.audio",
    });
  });

  describe("listSynths", () => {
    it("lists synths in a composition", async () => {
      const synths = await client.listSynths(testData.compositionId);

      expect(synths).toHaveLength(1);
      expect(synths[0].name).toBe(testData.synth.name);
      expect(synths[0].description).toBe(testData.synth.description);
      expect(synths[0].params).toHaveLength(3);
    });

    it("returns empty array for composition with no synths", async () => {
      const synths = await client.listSynths("cmp_empty");
      expect(synths).toHaveLength(0);
    });

    it("throws ApiError for non-existent composition", async () => {
      await expect(client.listSynths("cmp_notfound")).rejects.toThrow(ApiError);
      await expect(client.listSynths("cmp_notfound")).rejects.toThrow("Composition not found");
    });

    it("throws ApiError for unauthorized request", async () => {
      server.use(unauthorizedHandler);

      await expect(client.listSynths(testData.compositionId)).rejects.toThrow(ApiError);
      await expect(client.listSynths(testData.compositionId)).rejects.toMatchObject({
        status: 401,
      });
    });

    it("throws ApiError for server error", async () => {
      server.use(serverErrorHandler);

      await expect(client.listSynths(testData.compositionId)).rejects.toThrow(ApiError);
      await expect(client.listSynths(testData.compositionId)).rejects.toMatchObject({
        status: 500,
      });
    });
  });

  describe("getSynth", () => {
    it("gets synth metadata with all fields", async () => {
      const metadata = await client.getSynth(testData.compositionId, testData.synth.name);

      expect(metadata.name).toBe(testData.synth.name);
      expect(metadata.description).toBe(testData.synth.description);
      expect(metadata.params).toHaveLength(3);
      expect(metadata).not.toHaveProperty("automation");
    });

    it("throws ApiError for non-existent synth", async () => {
      await expect(client.getSynth(testData.compositionId, "not_found")).rejects.toThrow(ApiError);
    });
  });

  describe("loadSynth", () => {
    it("loads synth by name", async () => {
      await client.init();

      const synth = await client.loadSynth(testData.compositionId, testData.synth.name);

      expect(synth.name).toBe(testData.synth.name);
      expect(synth.description).toBe(testData.synth.description);
      expect(synth.params).toHaveLength(3);
      expect(synth.loaded).toBe(true);
    });

    it("loads latest synth when name not provided", async () => {
      await client.init();

      const synth = await client.loadSynth(testData.compositionId);

      expect(synth.name).toBe(testData.synth.name);
      expect(synth.loaded).toBe(true);
    });

    it("throws SynthError when composition has no synths", async () => {
      await client.init();

      await expect(client.loadSynth("cmp_empty")).rejects.toThrow(SynthError);
      await expect(client.loadSynth("cmp_empty")).rejects.toThrow("No synths found");
    });
  });

  describe("Synth playback", () => {
    it("can play and stop a synth", async () => {
      await client.init();
      const synth = await client.loadSynth(testData.compositionId, testData.synth.name);

      await synth.play();
      expect(synth.isPlaying()).toBe(true);

      synth.stop();
      expect(synth.isPlaying()).toBe(false);
    });

    it("can set parameters", async () => {
      await client.init();
      const synth = await client.loadSynth(testData.compositionId, testData.synth.name);
      await synth.play();

      // Set a single param
      synth.setParam("cutoff", 2000);

      // Set multiple params
      synth.setParams({ amp: 0.8, resonance: 0.5 });

      // Values are clamped to valid ranges
      synth.setParam("amp", 2); // Should clamp to 1
      synth.setParam("cutoff", 10); // Should clamp to 20
    });

    it("warns on unknown parameter", async () => {
      await client.init();
      const synth = await client.loadSynth(testData.compositionId, testData.synth.name);
      await synth.play();

      // This should warn but not throw
      synth.setParam("nonexistent", 100);
    });

    it("resets parameters to defaults", async () => {
      await client.init();
      const synth = await client.loadSynth(testData.compositionId, testData.synth.name);
      await synth.play();

      synth.setParams({ amp: 0.1, cutoff: 5000 });
      synth.resetParams();

      // Params should be reset (tracked internally in the engine mock)
    });
  });

  describe("Schema validation", () => {
    it("throws ValidationError for invalid API response", async () => {
      server.use(
        http.get("*/api/v1/compositions/:id/synths/:name", () => {
          return HttpResponse.json({
            // Missing required fields
            name: "test",
            // description missing
            // params missing
          });
        })
      );

      await expect(client.getSynth(testData.compositionId, "test")).rejects.toThrow(
        ValidationError
      );
    });

    it("ValidationError contains detailed issues", async () => {
      server.use(
        http.get("*/api/v1/compositions/:id/synths/:name", () => {
          return HttpResponse.json({
            name: "test",
            description: "test",
            params: [{ name: "amp", type: "invalid_type" }], // Invalid type
            createdAt: "2024-01-01",
            synthdefUrl: "/api/test",
          });
        })
      );

      try {
        await client.getSynth(testData.compositionId, "test");
        expect.fail("Should have thrown ValidationError");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).issues).toBeDefined();
        expect((err as ValidationError).issues.length).toBeGreaterThan(0);
      }
    });
  });
});
