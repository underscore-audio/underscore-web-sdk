/**
 * Tests for the Synth class.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Synth } from "./synth.js";
import type { AudioEngine } from "./audio.js";
import type { ParamMetadata, SampleMetadata, VoiceDef, Score } from "./types.js";

let spawnInstanceCounter = 0;

describe("Synth", () => {
  let mockEngine: AudioEngine;
  let synth: Synth;

  const testParams: ParamMetadata[] = [
    { name: "amp", type: "amp", default: 0.5, min: 0, max: 1, description: "Volume" },
    {
      name: "cutoff",
      type: "freq",
      default: 1000,
      min: 20,
      max: 20000,
      description: "Filter cutoff",
    },
    {
      name: "resonance",
      type: "factor",
      default: 0.3,
      min: 0,
      max: 1,
      description: "Filter resonance",
    },
  ];

  const testSamples: SampleMetadata[] = [
    {
      bufferNum: 0,
      id: "choir",
      description: "Choir texture",
      s3Key: "samples/choir.wav",
      url: "https://example.com/choir.wav",
      durationSec: 4.5,
      channels: 2,
      sampleRate: 48000,
      loop: true,
    },
  ];

  beforeEach(() => {
    mockEngine = {
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      setParam: vi.fn(),
      setParams: vi.fn(),
      setParamOnNode: vi.fn(),
      freeNode: vi.fn(),
      spawnInstance: vi.fn().mockImplementation((_name: string) => {
        spawnInstanceCounter += 1;
        return Promise.resolve(1000 + spawnInstanceCounter);
      }),
      resumeContext: vi.fn().mockResolvedValue(undefined),
      getParam: vi.fn(),
      getAllParams: vi.fn().mockReturnValue({}),
      isPlaying: vi.fn().mockReturnValue(false),
      subscribe: vi.fn().mockReturnValue(() => {}),
      crossfadeTo: vi.fn().mockResolvedValue(undefined),
      isCrossfading: vi.fn().mockReturnValue(false),
    } as unknown as AudioEngine;
    spawnInstanceCounter = 0;

    synth = new Synth(mockEngine, "cmp_test123", "warm_pad", "A warm analog pad sound", testParams);
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
      (mockEngine.getAllParams as ReturnType<typeof vi.fn>).mockReturnValue({
        amp: 0.7,
        cutoff: 1500,
      });
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

  describe("samples", () => {
    it("returns undefined when no samples provided", () => {
      expect(synth.samples).toBeUndefined();
    });

    it("returns samples when provided", () => {
      const synthWithSamples = new Synth(
        mockEngine,
        "cmp_test123",
        "sample_pad",
        "A pad with samples",
        testParams,
        testSamples
      );
      expect(synthWithSamples.samples).toEqual(testSamples);
    });
  });

  describe("hasSamples", () => {
    it("returns false when no samples", () => {
      expect(synth.hasSamples).toBe(false);
    });

    it("returns false for empty samples array", () => {
      const synthEmptySamples = new Synth(
        mockEngine,
        "cmp_test123",
        "empty_pad",
        "A pad with empty samples",
        testParams,
        []
      );
      expect(synthEmptySamples.hasSamples).toBe(false);
    });

    it("returns true when samples present", () => {
      const synthWithSamples = new Synth(
        mockEngine,
        "cmp_test123",
        "sample_pad",
        "A pad with samples",
        testParams,
        testSamples
      );
      expect(synthWithSamples.hasSamples).toBe(true);
    });
  });

  describe("crossfadeIn()", () => {
    it("throws when not loaded", async () => {
      await expect(synth.crossfadeIn()).rejects.toThrow("Synth not loaded");
    });

    it("calls engine.crossfadeTo with default duration and amp from params", async () => {
      synth.markLoaded();
      await synth.crossfadeIn();
      expect(mockEngine.crossfadeTo).toHaveBeenCalledWith("warm_pad", 3, 0.5);
    });

    it("accepts custom duration", async () => {
      synth.markLoaded();
      await synth.crossfadeIn(5);
      expect(mockEngine.crossfadeTo).toHaveBeenCalledWith("warm_pad", 5, 0.5);
    });

    it("falls back to 0.3 amp when no amp param exists", async () => {
      const noAmpSynth = new Synth(
        mockEngine,
        "cmp_test123",
        "no_amp",
        "A synth without amp param",
        [
          {
            name: "cutoff",
            type: "freq",
            default: 1000,
            min: 20,
            max: 20000,
            description: "Filter cutoff",
          },
        ]
      );
      noAmpSynth.markLoaded();
      await noAmpSynth.crossfadeIn();
      expect(mockEngine.crossfadeTo).toHaveBeenCalledWith("no_amp", 3, 0.3);
    });
  });

  describe("isCrossfading()", () => {
    it("delegates to engine", () => {
      (mockEngine.isCrossfading as ReturnType<typeof vi.fn>).mockReturnValue(true);
      expect(synth.isCrossfading()).toBe(true);
      expect(mockEngine.isCrossfading).toHaveBeenCalled();
    });
  });

  describe("startPerformance() (single-voice)", () => {
    it("returns false when no automation timeline is loaded", () => {
      synth.markLoaded();
      expect(synth.startPerformance()).toBe(false);
    });

    it("returns true and schedules events when an automation timeline is present", () => {
      vi.useFakeTimers();
      const automationSynth = new Synth(
        mockEngine,
        "cmp_x",
        "auto_pad",
        "Automated pad",
        testParams,
        undefined,
        undefined,
        undefined,
        {
          durationSec: 30,
          loop: false,
          events: [
            { atSec: 1, param: "cutoff", value: 5000 },
            { atSec: 3, param: "amp", value: 0.7 },
          ],
        }
      );
      automationSynth.markLoaded();

      expect(automationSynth.startPerformance()).toBe(true);

      vi.advanceTimersByTime(1100);
      expect(mockEngine.setParam).toHaveBeenCalledWith("cutoff", 5000);

      vi.advanceTimersByTime(2100);
      expect(mockEngine.setParam).toHaveBeenCalledWith("amp", 0.7);

      vi.useRealTimers();
    });

    it("returns false when called before the synth is loaded", () => {
      const automationSynth = new Synth(
        mockEngine,
        "cmp_x",
        "auto_pad",
        "Automated pad",
        testParams,
        undefined,
        undefined,
        undefined,
        { durationSec: 30, loop: false, events: [{ atSec: 1, param: "cutoff", value: 5000 }] }
      );
      expect(automationSynth.startPerformance()).toBe(false);
    });
  });
});

describe("Synth (bundle)", () => {
  let mockEngine: AudioEngine;

  const voiceParams: Record<string, ParamMetadata[]> = {
    bass: [
      { name: "amp", type: "amp", default: 0.4, min: 0, max: 1, description: "Bass volume" },
      { name: "rootHz", type: "freq", default: 110, min: 20, max: 880, description: "Root" },
    ],
    pad: [
      { name: "amp", type: "amp", default: 0.3, min: 0, max: 1, description: "Pad volume" },
      { name: "rootHz", type: "freq", default: 110, min: 20, max: 880, description: "Root" },
      {
        name: "openness",
        type: "factor",
        default: 0.5,
        min: 0,
        max: 1,
        description: "Pad openness",
      },
    ],
  };

  const voices: VoiceDef[] = [
    {
      name: "bass",
      scsyndefUrl: "/api/v1/compositions/cmp_t/synths/piece/synthdef?voice=bass",
      params: voiceParams.bass,
    },
    {
      name: "pad",
      scsyndefUrl: "/api/v1/compositions/cmp_t/synths/piece/synthdef?voice=pad",
      params: voiceParams.pad,
    },
  ];

  beforeEach(() => {
    spawnInstanceCounter = 0;
    mockEngine = {
      play: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      setParam: vi.fn(),
      setParams: vi.fn(),
      setParamOnNode: vi.fn(),
      freeNode: vi.fn(),
      spawnInstance: vi.fn().mockImplementation((_name: string) => {
        spawnInstanceCounter += 1;
        return Promise.resolve(1000 + spawnInstanceCounter);
      }),
      resumeContext: vi.fn().mockResolvedValue(undefined),
      getParam: vi.fn(),
      getAllParams: vi.fn().mockReturnValue({}),
      isPlaying: vi.fn().mockReturnValue(false),
      subscribe: vi.fn().mockReturnValue(() => {}),
      crossfadeTo: vi.fn().mockResolvedValue(undefined),
      isCrossfading: vi.fn().mockReturnValue(false),
    } as unknown as AudioEngine;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeBundleSynth(score?: Score): Synth {
    const s = new Synth(
      mockEngine,
      "cmp_t",
      "piece",
      "An ensemble bundle",
      [],
      undefined,
      voices,
      score
    );
    s.markLoaded();
    return s;
  }

  describe("isBundle / voices / score accessors", () => {
    it("flags isBundle when voices are present", () => {
      const s = makeBundleSynth();
      expect(s.isBundle).toBe(true);
      expect(s.voices).toEqual(voices);
    });

    it("does not flag isBundle when voices are absent", () => {
      const s = new Synth(mockEngine, "cmp_t", "single", "Single", voiceParams.bass);
      expect(s.isBundle).toBe(false);
      expect(s.voices).toBeUndefined();
    });
  });

  describe("play()", () => {
    it("resumes the audio context but does NOT spawn voice[0]", async () => {
      /*
       * The original bug this contract guards against: bundle.play() used
       * to /s_new voice[0], which made voice 1 audible BEFORE the score
       * started and masked the multi-voice composition. play() must now
       * be a pure context-resume; voices enter via startPerformance().
       */
      const s = makeBundleSynth();
      await s.play();
      expect(mockEngine.resumeContext).toHaveBeenCalled();
      expect(mockEngine.spawnInstance).not.toHaveBeenCalled();
      expect(mockEngine.play).not.toHaveBeenCalled();
    });
  });

  describe("startPerformance()", () => {
    it("returns false when the bundle synth has not been markLoaded", () => {
      const s = new Synth(
        mockEngine,
        "cmp_t",
        "piece",
        "An ensemble bundle",
        [],
        undefined,
        voices,
        undefined
      );
      expect(s.startPerformance()).toBe(false);
    });

    it("schedules every score event via setTimeout when a score is present", () => {
      vi.useFakeTimers();
      const score: Score = {
        durationSec: 60,
        loop: false,
        events: [
          { atSec: 0, voice: "bass", action: "play", params: { rootHz: 110 } },
          { atSec: 5, voice: "pad", action: "play", params: { rootHz: 110 } },
          { atSec: 20, voice: "bass", action: "set", params: { rootHz: 220 }, rampSec: 10 },
          { atSec: 50, voice: "bass", action: "release", rampSec: 4 },
        ],
      };
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const s = makeBundleSynth(score);
      expect(s.startPerformance()).toBe(true);

      /*
       * Each event is a top-level setTimeout (4 events). Ramp steps
       * are scheduled lazily inside dispatchSet, so they don't appear
       * until the parent timer fires.
       */
      expect(setTimeoutSpy).toHaveBeenCalledTimes(4);
    });

    it("/s_news each voice at its scheduled atSec when the score plays", async () => {
      vi.useFakeTimers();
      const score: Score = {
        durationSec: 30,
        loop: false,
        events: [
          { atSec: 0, voice: "bass", action: "play", params: { amp: 0.4, rootHz: 110 } },
          { atSec: 5, voice: "pad", action: "play", params: { amp: 0.3 } },
        ],
      };
      const s = makeBundleSynth(score);
      s.startPerformance();

      await vi.advanceTimersByTimeAsync(0);
      expect(mockEngine.spawnInstance).toHaveBeenCalledWith(
        "bass",
        expect.objectContaining({ amp: 0.4, rootHz: 110 })
      );

      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockEngine.spawnInstance).toHaveBeenCalledWith(
        "pad",
        expect.objectContaining({ amp: 0.3 })
      );
    });

    it("falls back to playing all voices at t=0 when score is absent on a bundle", async () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const s = makeBundleSynth();
      expect(s.startPerformance()).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockEngine.spawnInstance).toHaveBeenCalledWith("bass", expect.any(Object));
      expect(mockEngine.spawnInstance).toHaveBeenCalledWith("pad", expect.any(Object));
      warnSpy.mockRestore();
    });
  });

  describe("setParam()", () => {
    it("forwards the param to every live voice that declares it", async () => {
      vi.useFakeTimers();
      const score: Score = {
        durationSec: 60,
        loop: false,
        events: [
          { atSec: 0, voice: "bass", action: "play" },
          { atSec: 0, voice: "pad", action: "play" },
        ],
      };
      const s = makeBundleSynth(score);
      s.startPerformance();
      await vi.advanceTimersByTimeAsync(0);

      s.setParam("rootHz", 220);

      const calls = (mockEngine.setParamOnNode as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[1] === "rootHz" && c[2] === 220
      );
      expect(calls).toHaveLength(2);
    });

    it("skips voices that do not declare the param", async () => {
      vi.useFakeTimers();
      const score: Score = {
        durationSec: 60,
        loop: false,
        events: [
          { atSec: 0, voice: "bass", action: "play" },
          { atSec: 0, voice: "pad", action: "play" },
        ],
      };
      const s = makeBundleSynth(score);
      s.startPerformance();
      await vi.advanceTimersByTimeAsync(0);

      s.setParam("openness", 0.8);

      const calls = (mockEngine.setParamOnNode as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[1] === "openness"
      );
      expect(calls).toHaveLength(1);
    });

    it("warns only when no voice declares the param", async () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const score: Score = {
        durationSec: 60,
        loop: false,
        events: [{ atSec: 0, voice: "bass", action: "play" }],
      };
      const s = makeBundleSynth(score);
      s.startPerformance();
      await vi.advanceTimersByTimeAsync(0);

      s.setParam("rootHz", 220);
      expect(warnSpy).not.toHaveBeenCalled();

      s.setParam("nonexistent", 1);
      expect(warnSpy).toHaveBeenCalledWith("Unknown parameter: nonexistent");
      warnSpy.mockRestore();
    });
  });

  describe("stop()", () => {
    it("frees every live voice and cancels every pending timer", async () => {
      vi.useFakeTimers();
      const score: Score = {
        durationSec: 120,
        loop: false,
        events: [
          { atSec: 0, voice: "bass", action: "play" },
          { atSec: 60, voice: "pad", action: "play" },
        ],
      };
      const s = makeBundleSynth(score);
      s.startPerformance();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockEngine.spawnInstance).toHaveBeenCalledTimes(1);

      s.stop();

      expect(mockEngine.freeNode).toHaveBeenCalled();

      const beforeStopCalls = (mockEngine.spawnInstance as ReturnType<typeof vi.fn>).mock.calls
        .length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect((mockEngine.spawnInstance as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        beforeStopCalls
      );
    });

    it("does not call engine.stop() for bundles (engine state is per-voice)", () => {
      const s = makeBundleSynth();
      s.stop();
      expect(mockEngine.stop).not.toHaveBeenCalled();
    });
  });

  describe("score release semantics", () => {
    it("frees the node directly when the voice has no gate param", async () => {
      vi.useFakeTimers();
      const score: Score = {
        durationSec: 30,
        loop: false,
        events: [
          { atSec: 0, voice: "bass", action: "play" },
          { atSec: 10, voice: "bass", action: "release" },
        ],
      };
      const s = makeBundleSynth(score);
      s.startPerformance();
      await vi.advanceTimersByTimeAsync(0);
      const playedNodeId = await (mockEngine.spawnInstance as ReturnType<typeof vi.fn>).mock
        .results[0].value;

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockEngine.freeNode).toHaveBeenCalledWith(playedNodeId);
    });
  });
});
