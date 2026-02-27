/**
 * Tests for SDK type definitions.
 *
 * These tests validate that our types match expected structures
 * and that type definitions are correct.
 */

import { describe, it, expect } from "vitest";
import type {
  UnderscoreConfig,
  ParamMetadata,
  ParamType,
  ParamScale,
  SynthSummary,
  SynthMetadata,
  SynthState,
  GenerationEvent,
  GenerationEventType,
} from "./types.js";

describe("types", () => {
  describe("UnderscoreConfig", () => {
    it("accepts minimal valid config", () => {
      const config: UnderscoreConfig = {
        apiKey: "us_test_key",
      };
      expect(config.apiKey).toBe("us_test_key");
      expect(config.baseUrl).toBeUndefined();
      expect(config.wasmBaseUrl).toBeUndefined();
    });

    it("accepts full config", () => {
      const config: UnderscoreConfig = {
        apiKey: "us_test_key",
        baseUrl: "https://api.example.com",
        wasmBaseUrl: "/assets/supersonic/",
        workerBaseUrl: "/assets/supersonic/workers/",
      };
      expect(config.apiKey).toBe("us_test_key");
      expect(config.baseUrl).toBe("https://api.example.com");
    });
  });

  describe("ParamMetadata", () => {
    it("represents an amp parameter", () => {
      const param: ParamMetadata = {
        name: "amp",
        type: "amp",
        default: 0.5,
        min: 0,
        max: 1,
        description: "Output volume",
      };
      expect(param.name).toBe("amp");
      expect(param.type).toBe("amp");
    });

    it("represents a freq parameter with scale", () => {
      const param: ParamMetadata = {
        name: "cutoff",
        type: "freq",
        default: 1000,
        min: 20,
        max: 20000,
        scale: "log",
        unit: "Hz",
        description: "Filter cutoff frequency",
      };
      expect(param.scale).toBe("log");
      expect(param.unit).toBe("Hz");
    });

    it("represents a control parameter", () => {
      const param: ParamMetadata = {
        name: "pressure",
        type: "control",
        default: 0.3,
        min: 0,
        max: 1,
        description: "Intensity control",
      };
      expect(param.type).toBe("control");
    });

    it("represents a tempo parameter", () => {
      const param: ParamMetadata = {
        name: "bpm",
        type: "tempo",
        default: 120,
        min: 40,
        max: 200,
        description: "Beats per minute",
      };
      expect(param.type).toBe("tempo");
    });

    it("validates default is within range", () => {
      const param: ParamMetadata = {
        name: "test",
        type: "control",
        default: 0.5,
        min: 0,
        max: 1,
        description: "Test param",
      };
      expect(param.default).toBeGreaterThanOrEqual(param.min);
      expect(param.default).toBeLessThanOrEqual(param.max);
    });
  });

  describe("SynthSummary", () => {
    it("represents synth list item", () => {
      const summary: SynthSummary = {
        name: "warm_pad",
        description: "A warm analog pad sound",
        params: [],
        createdAt: "2024-01-15T10:30:00Z",
      };
      expect(summary.name).toBe("warm_pad");
    });
  });

  describe("SynthMetadata", () => {
    it("represents full synth details", () => {
      const metadata: SynthMetadata = {
        name: "warm_pad",
        description: "A warm analog pad sound",
        params: [
          {
            name: "amp",
            type: "amp",
            default: 0.5,
            min: 0,
            max: 1,
            description: "Output volume",
          },
        ],
        createdAt: "2024-01-15T10:30:00Z",
        synthdefUrl: "/api/v1/compositions/cmp_123/synths/warm_pad/synthdef",
      };
      expect(metadata.synthdefUrl).toContain("synthdef");
    });

  });

  describe("SynthState", () => {
    it("represents playing state", () => {
      const state: SynthState = {
        playing: true,
        synthName: "warm_pad",
        paramValues: { cutoff: 2000, amp: 0.7 },
      };
      expect(state.playing).toBe(true);
      expect(state.paramValues.cutoff).toBe(2000);
    });

    it("represents stopped state", () => {
      const state: SynthState = {
        playing: false,
        synthName: null,
        paramValues: {},
      };
      expect(state.playing).toBe(false);
      expect(state.synthName).toBeNull();
    });
  });

  describe("GenerationEvent", () => {
    it("supports all event types", () => {
      const types: GenerationEventType[] = ["thinking", "progress", "code", "ready", "error"];
      types.forEach((type) => {
        const event: GenerationEvent = { type };
        expect(event.type).toBe(type);
      });
    });

    it("represents thinking event", () => {
      const event: GenerationEvent = {
        type: "thinking",
        content: "Analyzing the request...",
      };
      expect(event.type).toBe("thinking");
      expect(event.content).toBeDefined();
    });

    it("represents ready event", () => {
      const event: GenerationEvent = {
        type: "ready",
        synthName: "new_synth",
      };
      expect(event.type).toBe("ready");
      expect(event.synthName).toBe("new_synth");
    });

    it("represents error event", () => {
      const event: GenerationEvent = {
        type: "error",
        error: "Generation failed",
      };
      expect(event.type).toBe("error");
      expect(event.error).toBeDefined();
    });
  });
});
