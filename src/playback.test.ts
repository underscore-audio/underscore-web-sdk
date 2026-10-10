import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackCore, prepareSynth, prepareProgram, type PreparedSynth } from "./playback.js";
import type { AudioEngine } from "./audio.js";
import type { SynthStateListener, ProgramManifest } from "./types.js";

function harness() {
  let now = 100;
  let playing = false;
  let name: string | null = null;
  let params: Record<string, number> = {};
  const listeners = new Set<SynthStateListener>();
  const sends: Array<unknown[]> = [];
  const notify = (): void => {
    for (const listener of listeners)
      listener({ playing, synthName: name, paramValues: { ...params } });
  };
  const sonic = {
    superClock: { now: () => now },
    audioContext: {
      state: "running",
      currentTime: 0,
      resume: vi.fn().mockResolvedValue(undefined),
    },
    purge: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    send: vi.fn((...packet: unknown[]) => sends.push(packet)),
    sendOSC: vi.fn(),
  };
  const engine = {
    engine: sonic,
    oscEncoder: { encodeBundle: vi.fn(() => new Uint8Array(1)) },
    audioContext: sonic.audioContext,
    get playingNodeId() {
      return playing ? 1000 : null;
    },
    analyserNode: null,
    init: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn(() => true),
    resume: vi.fn().mockResolvedValue(undefined),
    subscribe: (listener: SynthStateListener) => {
      listeners.add(listener);
      notify();
      return () => listeners.delete(listener);
    },
    play: vi.fn(async (nextName: string) => {
      name = nextName;
      playing = true;
      params = {};
      notify();
    }),
    stop: vi.fn(() => {
      playing = false;
      notify();
    }),
    cancelCrossfade: vi.fn(),
    clearBuffers: vi.fn(),
    loadSynthdefFromData: vi.fn().mockResolvedValue(undefined),
    loadSampleFromData: vi.fn().mockResolvedValue(undefined),
    freeSynthDefs: vi.fn(),
    cacheParams: vi.fn((next: Record<string, number>) => {
      params = { ...params, ...next };
    }),
    setParam: vi.fn((key: string, value: number) => {
      params[key] = value;
    }),
    setParams: vi.fn((next: Record<string, number>) => {
      params = { ...params, ...next };
    }),
    setMasterVolume: vi.fn(),
    getMasterVolume: () => 1,
  };
  const core = new PlaybackCore({ engine: engine as unknown as AudioEngine });
  return {
    core,
    engine,
    sonic,
    sends,
    setClock: (value: number) => {
      now = value;
    },
  };
}
function synth(identity = "one"): PreparedSynth {
  return prepareSynth({
    identity,
    name: `pad_${identity}`,
    description: "Pad",
    synthdef: new ArrayBuffer(4),
    params: [
      { name: "cutoff", type: "freq", min: 100, max: 1100, default: 100, description: "Cutoff" },
      { name: "amp", type: "amp", min: 0, max: 1, default: 0.2, description: "Level" },
    ],
    score: {
      totalDurationSec: 4,
      events: [
        { tMs: 0, params: { amp: 0.4 } },
        { tMs: 2000, curve: "linear", params: { cutoff: 1100, amp: 0.8 } },
        { tMs: 4000, params: { amp: 0 } },
      ],
    },
  });
}
const manifest: ProgramManifest = {
  format: 1,
  name: "piece",
  title: "Piece",
  description: "Piece",
  bpm: 120,
  beatsPerBar: 4,
  durationBeats: 8,
  synthdefs: ["pad"],
  buses: [],
  sections: [{ name: "Start", beat: 0 }],
  setup: [
    { cmd: "/g_new", args: [10, 0, 0] },
    { cmd: "/g_new", args: [20, 3, 10] },
  ],
  events: [{ beat: 0, cmd: "/s_new", args: ["pad", 100, 1, 10] }],
};

describe("PlaybackCore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resumes a suspended playing context without rebuilding the graph or changing held values", async () => {
    const h = harness();
    await h.core.activate(synth(), { play: true });
    await h.core.setParam("cutoff", 700);
    const before = h.core.getSnapshot();
    const plays = h.engine.play.mock.calls.length;
    h.sonic.audioContext.state = "suspended";
    h.engine.resume.mockImplementationOnce(async () => {
      h.sonic.audioContext.state = "running";
    });
    await h.core.play();
    expect(h.engine.resume).toHaveBeenCalledTimes(1);
    expect(h.engine.play).toHaveBeenCalledTimes(plays);
    expect(h.core.getSnapshot()).toMatchObject({
      playing: true,
      params: before.params,
      manual: before.manual,
      positionSec: before.positionSec,
      error: null,
    });
    await h.core.stop();
  });

  it.each([false, true])(
    "foreground repair never restarts the previous source across a queued selection (play=%s)",
    async (play) => {
      const h = harness();
      await h.core.activate(synth("old"), { play: true });
      const plays = h.engine.play.mock.calls.length;
      const next = h.core.activate(synth("next"), { play });
      const repair = h.core.play();
      await Promise.all([next, repair]);
      expect(h.core.getSnapshot()).toMatchObject({ identity: "next", playing: play });
      expect(h.engine.play).toHaveBeenCalledTimes(plays + (play ? 1 : 0));
      await h.core.stop();
    }
  );

  it("clears superseded activation ownership and keeps a late resume silent after reset", async () => {
    const h = harness();
    await h.core.activate(synth("old"), { play: true });
    const stale = h.core.synthDriver(synth("stale"));
    const start = stale.play();
    const seek = h.core.seek(1);
    await Promise.all([start, seek]);
    stale.stop();
    expect(h.core.getSnapshot()).toMatchObject({ identity: "old", playing: true });
    let release!: () => void;
    h.engine.resume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const repair = h.core.play();
    for (let i = 0; i < 12 && !release; i++) await Promise.resolve();
    expect(release).toBeDefined();
    const reset = h.core.reset();
    release();
    await Promise.all([repair, reset]);
    expect(h.core.getSnapshot()).toMatchObject({ identity: null, playing: false, error: null });
    await h.core.activate(synth("next"), { play: false });
    stale.stop();
    expect(h.core.getSnapshot()).toMatchObject({ identity: "next", playing: false });
  });

  it("reports denied context recovery and ignores its late failure after Stop", async () => {
    const h = harness();
    await h.core.activate(synth(), { play: true });
    h.engine.resume.mockRejectedValueOnce(new Error("Tap Play again to enable sound"));
    await expect(h.core.play()).rejects.toThrow("Tap Play again");
    expect(h.core.getSnapshot().error).toBe("Tap Play again to enable sound");
    let deny!: (error: Error) => void;
    h.engine.resume.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          deny = reject;
        })
    );
    const repair = h.core.play();
    for (let i = 0; i < 12 && !deny; i++) await Promise.resolve();
    expect(deny).toBeDefined();
    const stop = h.core.stop();
    const error = h.core.getSnapshot().error;
    deny(new Error("Late failure"));
    await expect(repair).rejects.toThrow("Late failure");
    await stop;
    expect(h.core.getSnapshot()).toMatchObject({ playing: false, error });
  });

  it.each(["synth", "program"] as const)(
    "the %s handle can cancel Play before selection is published",
    async (kind) => {
      const h = harness();
      const handle =
        kind === "synth"
          ? h.core.synthDriver(synth())
          : h.core.createProgram(
              prepareProgram({
                identity: "one",
                name: "piece",
                manifest,
                synthdefs: new Map([["pad", new ArrayBuffer(4)]]),
              })
            );
      const start = handle.play();
      await handle.stop();
      await start;
      expect(h.engine.play).not.toHaveBeenCalled();
      expect(h.sends.some((packet) => packet[0] === "/s_new")).toBe(false);
      expect(h.core.getSnapshot().playing).toBe(false);
    }
  );

  it.each([
    ["synth", "initialization"],
    ["synth", "upload"],
    ["program", "initialization"],
    ["program", "upload"],
  ] as const)("the %s handle cancels Play during deferred %s", async (kind, stage) => {
    const h = harness();
    let release!: () => void;
    const pending = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    if (stage === "initialization") h.engine.init.mockImplementationOnce(pending);
    else h.engine.loadSynthdefFromData.mockImplementationOnce(pending);
    const handle =
      kind === "synth"
        ? h.core.synthDriver(synth())
        : h.core.createProgram(
            prepareProgram({
              identity: "one",
              name: "piece",
              manifest,
              synthdefs: new Map([["pad", new ArrayBuffer(4)]]),
            })
          );
    const start = handle.play();
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
    expect(release).toBeDefined();
    const stop = handle.stop();
    release();
    await Promise.all([start, stop]);
    expect(h.engine.play).not.toHaveBeenCalled();
    expect(h.sends.some((packet) => packet[0] === "/s_new")).toBe(false);
    expect(h.core.getSnapshot().playing).toBe(false);
  });

  it("an old handle cannot stop a newer pending or active source", async () => {
    const h = harness();
    const old = h.core.synthDriver(synth("old"));
    const next = h.core.synthDriver(synth("next"));
    await old.play();
    let release!: () => void;
    h.engine.init.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const start = next.play();
    old.stop();
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
    expect(release).toBeDefined();
    old.stop();
    release();
    await start;
    expect(h.core.getSnapshot()).toMatchObject({ identity: "next", playing: true });
    old.stop();
    expect(h.core.getSnapshot()).toMatchObject({ identity: "next", playing: true });
    await next.stop();
  });

  it("prepares B without uploading or changing the sounding source A", async () => {
    const h = harness();
    await h.core.activate(synth(), { play: true });
    const snapshot = h.core.getSnapshot();
    const uploads = h.engine.loadSynthdefFromData.mock.calls.length;
    const stops = h.engine.stop.mock.calls.length;
    prepareSynth({ ...synth("two"), samples: [{ bufferNum: 0, data: new ArrayBuffer(16) }] });
    prepareProgram({
      identity: "program",
      name: "piece",
      manifest,
      synthdefs: new Map([["pad", new ArrayBuffer(4)]]),
    });
    expect(h.core.getSnapshot()).toBe(snapshot);
    expect(h.engine.loadSynthdefFromData).toHaveBeenCalledTimes(uploads);
    expect(h.engine.stop).toHaveBeenCalledTimes(stops);
    expect(h.engine.loadSampleFromData).not.toHaveBeenCalled();
    await h.core.stop();
  });

  it("captures every value once, holds all lanes, then restores the same score position and values", async () => {
    const h = harness();
    await h.core.activate(synth(), { play: true });
    h.setClock(101.05);
    await h.core.setParam("cutoff", 300);
    const first = h.core.getSnapshot().manual;
    expect(first?.positionSec).toBeCloseTo(1);
    expect(Object.keys(first?.values ?? {})).toEqual(["cutoff", "amp"]);
    expect(first?.values.cutoff).toBeCloseTo(595);
    expect(first?.values.amp).toBeCloseTo(0.598);
    h.setClock(110);
    await h.core.setParam("amp", 0.1);
    vi.advanceTimersByTime(1000);
    expect(h.core.getSnapshot().manual).toBe(first);
    expect(h.core.getSnapshot().params).toEqual({ cutoff: 300, amp: 0.1 });
    expect(h.core.getSnapshot().positionSec).toBeCloseTo(1);
    await h.core.resumeAutomation();
    expect(h.core.getSnapshot().manual).toBeNull();
    expect(h.engine.setParams).toHaveBeenLastCalledWith(first?.values);
    expect(h.core.getSnapshot().positionSec).toBeCloseTo(1);
    expect(h.core.getSnapshot().playing).toBe(true);
    h.setClock(110.55);
    vi.advanceTimersByTime(100);
    expect(h.core.getSnapshot().positionSec).toBeCloseTo(1.5);
    await h.core.stop();
  });

  it("a value-preserving tap does not take over; ordinary SDK writes do not hold automation", async () => {
    const h = harness();
    await h.core.activate(synth(), { play: true });
    await h.core.setParam("cutoff", 100);
    expect(h.core.getSnapshot().manual).toBeNull();
    await h.core.writeParam("cutoff", 350);
    expect(h.core.getSnapshot().manual).toBeNull();
    expect(h.engine.setParam).toHaveBeenLastCalledWith("cutoff", 350);
    await h.core.stop();
  });

  it("keeps manual state through Stop, Play and a source switch; Resume while stopped remains silent", async () => {
    const h = harness();
    const one = synth();
    await h.core.activate(one, { play: true });
    h.setClock(101.05);
    await h.core.setParam("amp", 0.1);
    const captured = h.core.getSnapshot().manual;
    await h.core.stop();
    await h.core.play();
    expect(h.core.getSnapshot().manual).toBe(captured);
    expect(h.engine.setParams).toHaveBeenLastCalledWith({ cutoff: 595, amp: 0.1 });
    await h.core.activate(synth("two"), { play: false });
    await h.core.activate(one, { play: false });
    expect(h.core.getSnapshot().manual).toEqual(captured);
    const starts = h.engine.play.mock.calls.length;
    await h.core.resumeAutomation();
    expect(h.core.getSnapshot().playing).toBe(false);
    expect(h.core.getSnapshot().params).toEqual(captured?.values);
    expect(h.engine.play).toHaveBeenCalledTimes(starts);
  });

  it("a new adjustment supersedes a pending Resume without moving the saved position", async () => {
    const h = harness();
    await h.core.activate(synth(), { play: true });
    h.setClock(101.05);
    await h.core.setParam("cutoff", 300);
    const resumed = h.core.resumeAutomation();
    const adjusted = h.core.setParam("amp", 0.1);
    await Promise.all([resumed, adjusted]);
    expect(h.core.getSnapshot().manual?.positionSec).toBeCloseTo(1);
    expect(h.core.getSnapshot().params.amp).toBe(0.1);
    const bundles = h.sonic.sendOSC.mock.calls.length;
    h.setClock(110);
    vi.advanceTimersByTime(1000);
    expect(h.sonic.sendOSC).toHaveBeenCalledTimes(bundles);
    expect(h.core.getSnapshot().params.amp).toBe(0.1);
    await h.core.stop();
  });

  it("seeking clears takeover and respects stopped intent", async () => {
    const h = harness();
    await h.core.activate(synth(), { play: true });
    await h.core.setParam("amp", 0.1);
    await h.core.stop();
    const starts = h.engine.play.mock.calls.length;
    await h.core.seek(2);
    expect(h.core.getSnapshot()).toMatchObject({
      manual: null,
      playing: false,
      positionSec: 2,
      params: { cutoff: 1100, amp: 0.8 },
    });
    expect(h.engine.play).toHaveBeenCalledTimes(starts);
  });

  it.each(["initialization", "definition upload"])(
    "retains requested Play when a real control edit holds automation during %s",
    async (pendingStage) => {
      const h = harness();
      await h.core.activate(synth(), { play: false });
      let release: (() => void) | undefined;
      const pending = () =>
        new Promise<void>((resolve) => {
          release = resolve;
        });
      if (pendingStage === "initialization") h.engine.init.mockImplementationOnce(pending);
      else h.engine.loadSynthdefFromData.mockImplementationOnce(pending);
      const requested = h.core.play();
      for (let count = 0; count < 10 && !release; count++) await Promise.resolve();
      expect(release).toBeDefined();
      const edited = h.core.setParam("cutoff", 300);
      const captured = h.core.getSnapshot().manual;
      expect(captured).toEqual({
        identity: "one",
        positionSec: 0,
        values: { cutoff: 100, amp: 0.4 },
      });
      release?.();
      await Promise.all([requested, edited]);
      expect(h.engine.play).toHaveBeenCalledWith("pad_one");
      expect(h.core.getSnapshot()).toMatchObject({
        playing: true,
        manual: captured,
        params: { cutoff: 300, amp: 0.4 },
      });
      h.setClock(101.05);
      vi.advanceTimersByTime(1000);
      expect(h.core.getSnapshot().positionSec).toBe(0);
      expect(h.sonic.sendOSC).not.toHaveBeenCalled();
      await h.core.resumeAutomation();
      expect(h.engine.setParams).toHaveBeenLastCalledWith(captured?.values);
      expect(h.sonic.sendOSC).toHaveBeenCalled();
      h.setClock(101.6);
      vi.advanceTimersByTime(100);
      expect(h.core.getSnapshot().positionSec).toBeCloseTo(0.5);
      await h.core.stop();
    }
  );

  it("retains requested Play when held controls resume during initialization", async () => {
    const h = harness();
    await h.core.activate(synth(), { play: false });
    await h.core.setParam("cutoff", 300);
    const captured = h.core.getSnapshot().manual;
    let release: (() => void) | undefined;
    h.engine.init.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const requested = h.core.play();
    for (let count = 0; count < 10 && !release; count++) await Promise.resolve();
    expect(release).toBeDefined();
    const resumed = h.core.resumeAutomation();
    release?.();
    await Promise.all([requested, resumed]);
    expect(h.core.getSnapshot()).toMatchObject({ playing: true, manual: null });
    expect(h.engine.setParams).toHaveBeenLastCalledWith(captured?.values);
    h.setClock(100.55);
    vi.advanceTimersByTime(100);
    expect(h.core.getSnapshot().positionSec).toBeCloseTo(0.5);
    await h.core.stop();
  });

  it("a superseded upload cannot start its source or clear the next source", async () => {
    const h = harness();
    let release: (() => void) | undefined;
    h.engine.loadSynthdefFromData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const first = h.core.activate(synth(), { play: true });
    for (let count = 0; count < 10 && !release; count++) await Promise.resolve();
    expect(release).toBeDefined();
    const second = h.core.activate(synth("two"), { play: true });
    release?.();
    await Promise.all([first, second]);
    expect(h.engine.play.mock.calls.map((call) => call[0])).toEqual(["pad_two"]);
    expect(h.core.getSnapshot()).toMatchObject({ identity: "two", playing: true });
    await h.core.stop("one");
    expect(h.core.getSnapshot().playing).toBe(true);
    await h.core.stop();
  });

  it("Stop wins over a pending activation and natural completion emits the final position", async () => {
    const h = harness();
    let release: (() => void) | undefined;
    h.engine.loadSynthdefFromData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const first = h.core.activate(synth(), { play: true });
    for (let count = 0; count < 10 && !release; count++) await Promise.resolve();
    const stopped = h.core.stop();
    release?.();
    await Promise.all([first, stopped]);
    expect(h.engine.play).not.toHaveBeenCalled();
    await h.core.activate(synth("two"), { play: true });
    const completions: number[] = [];
    let previouslyPlaying = true;
    h.core.subscribe(() => {
      const snapshot = h.core.getSnapshot();
      if (previouslyPlaying && !snapshot.playing) completions.push(snapshot.positionSec);
      previouslyPlaying = snapshot.playing;
    });
    h.setClock(104.1);
    vi.advanceTimersByTime(100);
    expect(h.core.getSnapshot()).toMatchObject({ playing: false, positionSec: 4 });
    expect(completions).toEqual([4]);
  });
  it("restores the exact artifact silently after reload and clears host state on owner reset", async () => {
    const before = harness();
    await before.core.activate(synth(), { play: true });
    before.setClock(101.05);
    await before.core.setParam("cutoff", 300);
    const saved = before.core.getSnapshot();
    await before.core.stop();
    const restored = harness();
    await restored.core.activate(synth(), { play: false });
    restored.core.restoreManual(saved.manual!, { ...saved.params });
    expect(restored.core.getSnapshot()).toMatchObject({
      playing: false,
      positionSec: 1,
      params: saved.params,
      manual: saved.manual,
    });
    expect(restored.engine.play).not.toHaveBeenCalled();
    expect(restored.engine.init).not.toHaveBeenCalled();
    await restored.core.activate(synth("two"), { play: false });
    restored.core.restoreManual(saved.manual!, { ...saved.params });
    expect(restored.core.getSnapshot().manual).toBeNull();
    await restored.core.reset();
    await restored.core.activate(synth(), { play: false });
    expect(restored.core.getSnapshot().manual).toBeNull();
  });

  it("plays historical score destinations without promoting missing metadata to writable controls", async () => {
    const h = harness();
    const artifact = prepareSynth({
      ...synth(),
      score: {
        totalDurationSec: 4,
        events: [
          { tMs: 0, params: { undocumented: 0.2 } },
          { tMs: 2000, curve: "linear", params: { undocumented: 0.7 } },
        ],
      },
    });
    await h.core.activate(artifact, { play: true });
    expect(h.core.getSnapshot()).toMatchObject({ playing: true, controlsWritable: false });
    expect(h.engine.setParams).toHaveBeenLastCalledWith({
      cutoff: 100,
      amp: 0.2,
      undocumented: 0.2,
    });
    await expect(h.core.setParam("cutoff", 300)).rejects.toThrow("no safe automation controls");
    expect(h.core.getSnapshot().manual).toBeNull();
    h.setClock(101.05);
    vi.advanceTimersByTime(100);
    expect(h.core.getSnapshot().params.undocumented).toBeCloseTo(0.4475);
    await h.core.stop();
  });

  it("keeps historical score values outside authored control ranges playable but read-only", async () => {
    const h = harness();
    const artifact = prepareSynth({
      ...synth(),
      score: { totalDurationSec: 4, events: [{ tMs: 0, params: { amp: 1.2 } }] },
    });
    await h.core.activate(artifact, { play: true });
    expect(h.core.getSnapshot()).toMatchObject({ playing: true, controlsWritable: false });
    expect(h.engine.setParams).toHaveBeenLastCalledWith({ cutoff: 100, amp: 1.2 });
    await expect(h.core.setParam("amp", 0.6)).rejects.toThrow("no safe automation controls");
    await h.core.stop();
  });

  it("honors authored discrete steps without taking over for equivalent values", async () => {
    const h = harness();
    const artifact = prepareSynth({
      ...synth(),
      score: undefined,
      params: [
        { name: "mode", type: "switch", min: 0, max: 1, default: 0, description: "Mode" },
        {
          name: "level",
          type: "amp",
          min: 0,
          max: 1,
          default: 0.3,
          step: 0.1,
          description: "Level",
        },
      ],
    });
    await h.core.activate(artifact, { play: false });
    await h.core.setParam("level", 0.301);
    expect(h.core.getSnapshot().manual).toBeNull();
    await h.core.setParam("mode", 0.7);
    expect(h.core.getSnapshot().params.mode).toBe(1);
    await h.core.setParam("level", 0.46);
    expect(h.core.getSnapshot().params.level).toBeCloseTo(0.5);
    expect(h.core.getSnapshot().manual?.values).toEqual({ mode: 0, level: 0.3 });
  });
  it("does not build a stale program graph after its definitions finish uploading", async () => {
    const h = harness();
    const program = (identity: string) =>
      prepareProgram({
        identity,
        name: identity,
        manifest: {
          ...manifest,
          name: identity,
          synthdefs: [identity],
          setup: [...manifest.setup, { cmd: "/s_new", args: [identity, 100, 1, 10] }],
        },
        synthdefs: new Map([[identity, new ArrayBuffer(4)]]),
      });
    let release: (() => void) | undefined;
    h.engine.loadSynthdefFromData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const stale = h.core.activate(program("one"), { play: true });
    for (let count = 0; count < 12 && !release; count++) await Promise.resolve();
    expect(release).toBeDefined();
    const current = h.core.activate(program("two"), { play: true });
    release?.();
    await Promise.all([stale, current]);
    expect(h.sends.filter((packet) => packet[0] === "/s_new")).toEqual([
      ["/s_new", "two", 100, 1, 10],
    ]);
    expect(h.core.getSnapshot()).toMatchObject({ identity: "two", playing: true });
    await h.core.stop();
  });

  it("seeks a running program in place and rejects an old seek after source takeover", async () => {
    const h = harness();
    const program = prepareProgram({
      identity: "program",
      name: "piece",
      manifest,
      synthdefs: new Map([["pad", new ArrayBuffer(4)]]),
    });
    await h.core.activate(program, { play: true });
    const groups = h.sends.filter((packet) => packet[0] === "/g_new").length;
    const uploads = h.engine.loadSynthdefFromData.mock.calls.length;
    await h.core.seek(1);
    expect(h.sends.filter((packet) => packet[0] === "/g_new")).toHaveLength(groups);
    expect(h.engine.loadSynthdefFromData).toHaveBeenCalledTimes(uploads);
    expect(h.core.getSnapshot()).toMatchObject({ playing: true, positionSec: 1 });
    let release: (() => void) | undefined;
    h.sonic.purge.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const oldSeek = h.core.seek(2);
    for (let count = 0; count < 8 && !release; count++) await Promise.resolve();
    const selected = h.core.activate(synth("two"), { play: true });
    release?.();
    await Promise.all([oldSeek, selected]);
    expect(h.core.getSnapshot()).toMatchObject({ identity: "two", playing: true });
    await h.core.stop();
  });
  it("selects and edits silently while a partially initialized engine cannot purge", async () => {
    const h = harness();
    h.engine.isInitialized.mockReturnValue(false);
    h.sonic.purge.mockRejectedValue(new Error("Not initialized"));
    await h.core.activate(synth(), { play: false });
    await h.core.setParam("amp", 0.1);
    await h.core.resumeAutomation();
    await h.core.stop();
    expect(h.sonic.purge).not.toHaveBeenCalled();
    expect(h.engine.init).not.toHaveBeenCalled();
    expect(h.engine.play).not.toHaveBeenCalled();
    expect(h.core.getSnapshot()).toMatchObject({ identity: "one", playing: false });
  });
  it("captures authoritative stopped values between visual progress ticks", async () => {
    const h = harness();
    await h.core.activate(synth(), { play: true });
    h.setClock(101.13);
    await h.core.stop();
    const stopped = h.core.getSnapshot();
    expect(stopped.positionSec).toBeCloseTo(1.08);
    expect(stopped.params.cutoff).toBeCloseTo(640);
    expect(stopped.params.amp).toBeCloseTo(0.616);
    await h.core.setParam("cutoff", 300);
    expect(h.core.getSnapshot().manual?.values).toEqual(stopped.params);
    expect(h.core.getSnapshot().manual?.positionSec).toBeCloseTo(1.08);
  });
});
