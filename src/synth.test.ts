/**
 * Tests for the Synth class.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Synth } from "./synth.js";
import type { AudioEngine } from "./audio.js";
import type { ParamMetadata, AutomationPlan } from "./types.js";

describe("Synth", () => {
  let mockEngine: AudioEngine;
  let synth: Synth;
  
  const testParams: ParamMetadata[] = [
    { name: "amp", type: "amp", default: 0.5, min: 0, max: 1, description: "Volume" },
    { name: "cutoff", type: "freq", default: 1000, min: 20, max: 20000, description: "Filter cutoff" },
    { name: "resonance", type: "factor", default: 0.3, min: 0, max: 1, description: "Filter resonance" },
  ];

  const testAutomation: AutomationPlan = {
    title: "Test Plan",
    durationSec: 60,
    lanes: [
      { param: "cutoff", keyframes: [{ t: 0, value: 500 }, { t: 60, value: 2000 }] },
    ],
  };

  beforeEach(() => {
    mockEngine = {
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      setParam: vi.fn(),
      setParams: vi.fn(),
      getParam: vi.fn(),
      getAllParams: vi.fn().mockReturnValue({}),
      isPlaying: vi.fn().mockReturnValue(false),
      subscribe: vi.fn().mockReturnValue(() => {}),
    } as unknown as AudioEngine;

    synth = new Synth(
      mockEngine,
      "cmp_test123",
      "warm_pad",
      "A warm analog pad sound",
      testParams,
      testAutomation
    );
  });

  describe("properties", () => {
    it("exposes compositionId", () => {
      expect(synth.compositionId).toBe("cmp_test123");
    });

    it("exposes name", () => {
      expect(synth.name).toBe("warm_pad");
    });

    it("exposes description", () => {
      expect(synth.description).toBe("A warm analog pad sound");
    });

    it("exposes params", () => {
      expect(synth.params).toEqual(testParams);
      expect(synth.params).toHaveLength(3);
    });

    it("exposes automation", () => {
      expect(synth.automation).toEqual(testAutomation);
    });

    it("is not loaded by default", () => {
      expect(synth.loaded).toBe(false);
    });
  });

  describe("markLoaded()", () => {
    it("marks synth as loaded", () => {
      expect(synth.loaded).toBe(false);
      synth.markLoaded();
      expect(synth.loaded).toBe(true);
    });
  });

  describe("play()", () => {
    it("throws when not loaded", async () => {
      await expect(synth.play()).rejects.toThrow("Synth not loaded");
    });

    it("calls engine.play() when loaded", async () => {
      synth.markLoaded();
      await synth.play();
      expect(mockEngine.play).toHaveBeenCalledWith("warm_pad");
    });
  });

  describe("stop()", () => {
    it("calls engine.stop()", () => {
      synth.stop();
      expect(mockEngine.stop).toHaveBeenCalled();
    });
  });

  describe("setParam()", () => {
    it("sets valid parameter", () => {
      synth.setParam("cutoff", 2000);
      expect(mockEngine.setParam).toHaveBeenCalledWith("cutoff", 2000);
    });

    it("clamps value to min", () => {
      synth.setParam("cutoff", 10); // min is 20
      expect(mockEngine.setParam).toHaveBeenCalledWith("cutoff", 20);
    });

    it("clamps value to max", () => {
      synth.setParam("cutoff", 25000); // max is 20000
      expect(mockEngine.setParam).toHaveBeenCalledWith("cutoff", 20000);
    });

    it("warns on unknown parameter", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      synth.setParam("unknown_param", 100);
      expect(warnSpy).toHaveBeenCalledWith("Unknown parameter: unknown_param");
      expect(mockEngine.setParam).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("setParams()", () => {
    it("sets multiple valid parameters", () => {
      synth.setParams({ cutoff: 2000, amp: 0.8 });
      expect(mockEngine.setParams).toHaveBeenCalledWith({ cutoff: 2000, amp: 0.8 });
    });

    it("filters out unknown parameters", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      synth.setParams({ cutoff: 2000, unknown: 100 });
      expect(mockEngine.setParams).toHaveBeenCalledWith({ cutoff: 2000 });
      expect(warnSpy).toHaveBeenCalledWith("Unknown parameter: unknown");
      warnSpy.mockRestore();
    });

    it("clamps all values to ranges", () => {
      synth.setParams({ amp: 2, cutoff: 5 }); // amp max=1, cutoff min=20
      expect(mockEngine.setParams).toHaveBeenCalledWith({ amp: 1, cutoff: 20 });
    });

    it("does not call engine if all params invalid", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      synth.setParams({ invalid1: 100, invalid2: 200 });
      expect(mockEngine.setParams).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("getParam()", () => {
    it("delegates to engine", () => {
      (mockEngine.getParam as ReturnType<typeof vi.fn>).mockReturnValue(1500);
      expect(synth.getParam("cutoff")).toBe(1500);
      expect(mockEngine.getParam).toHaveBeenCalledWith("cutoff");
    });
  });

  describe("getAllParams()", () => {
    it("delegates to engine", () => {
      (mockEngine.getAllParams as ReturnType<typeof vi.fn>).mockReturnValue({ amp: 0.7, cutoff: 1500 });
      expect(synth.getAllParams()).toEqual({ amp: 0.7, cutoff: 1500 });
    });
  });

  describe("resetParams()", () => {
    it("resets all params to defaults", () => {
      synth.resetParams();
      expect(mockEngine.setParams).toHaveBeenCalledWith({
        amp: 0.5,
        cutoff: 1000,
        resonance: 0.3,
      });
    });
  });

  describe("isPlaying()", () => {
    it("delegates to engine", () => {
      (mockEngine.isPlaying as ReturnType<typeof vi.fn>).mockReturnValue(true);
      expect(synth.isPlaying()).toBe(true);
    });
  });

  describe("subscribe()", () => {
    it("delegates to engine", () => {
      const listener = vi.fn();
      const mockUnsubscribe = vi.fn();
      (mockEngine.subscribe as ReturnType<typeof vi.fn>).mockReturnValue(mockUnsubscribe);
      
      const unsubscribe = synth.subscribe(listener);
      
      expect(mockEngine.subscribe).toHaveBeenCalledWith(listener);
      expect(unsubscribe).toBe(mockUnsubscribe);
    });
  });
});
