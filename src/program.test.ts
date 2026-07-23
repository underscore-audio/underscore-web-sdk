/**
 * Tests for Program + ProgramTransport against a fake AudioEngine.
 *
 * The harness exposes a controllable superClock and records every
 * immediate OSC send and every encoded timestamped bundle, so these tests
 * assert the replay contract end to end: setup ordering, anchor math,
 * lookahead pumping, seek re-anchoring (purge + stem restore), teardown
 * serialization, def-switch RT-memory hygiene, and playback exclusivity.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AudioEngine } from "./audio.js";
import type { ProgramManifest } from "./types.js";
import type { OscPacket } from "./bundle-pump.js";
import { Program, ProgramTransport, type ProgramProgress } from "./program.js";
import { SynthError } from "./errors.js";

interface SentBundle {
  timeTag: number;
  packets: OscPacket[];
}

function makeHarness(startClock = 100) {
  let clockNow = startClock;
  const sends: OscPacket[] = [];
  const bundles: SentBundle[] = [];
  const pending = new Map<Uint8Array, SentBundle>();

  const sonic = {
    audioContext: { state: "running", resume: vi.fn().mockResolvedValue(undefined) },
    superClock: { now: () => clockNow },
    send: vi.fn((cmd: string, ...args: Array<string | number>) => {
      sends.push([cmd, ...args]);
    }),
    sendOSC: vi.fn((encoded: Uint8Array) => {
      bundles.push(pending.get(encoded)!);
    }),
    purge: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
  };

  const encoder = {
    encodeBundle: (timeTag: number, packets: OscPacket[]) => {
      const bytes = new Uint8Array([pending.size % 256]);
      pending.set(bytes, { timeTag, packets });
      return bytes;
    },
  };

  const engine = {
    engine: sonic,
    oscEncoder: encoder,
    loadSynthdefFromData: vi.fn().mockResolvedValue(undefined),
    freeSynthDefs: vi.fn(),
    stop: vi.fn(),
  } as unknown as AudioEngine;

  return {
    engine,
    sonic,
    sends,
    bundles,
    setClock: (value: number) => {
      clockNow = value;
    },
  };
}

/* 120 bpm -> 0.5 sec per beat; 8 beats -> 4 seconds total. */
const manifest: ProgramManifest = {
  format: 1,
  name: "seeker",
  title: "Seeker",
  description: "A test piece",
  bpm: 120,
  beatsPerBar: 4,
  durationBeats: 8,
  synthdefs: ["pad", "bass"],
  buses: [{ name: "verb", index: 4, channels: 2 }],
  sections: [
    { name: "intro", beat: 0 },
    { name: "outro", beat: 4 },
  ],
  setup: [
    { cmd: "/g_new", args: [10, 0, 0] },
    { cmd: "/g_new", args: [20, 3, 10] },
    { cmd: "/s_new", args: ["pad", 100, 1, 10, "amp", 0.5] },
  ],
  events: [
    { beat: 0, cmd: "/s_new", args: ["bass", 100000, 1, 10] },
    { beat: 2, cmd: "/n_set", args: [100, "amp", 0.8] },
    { beat: 6, cmd: "/n_set", args: [100, "amp", 0.2] },
  ],
};

function makeProgram(
  transport: ProgramTransport,
  overrides: Partial<ProgramManifest> = {},
  name = "seeker"
): Program {
  const merged = { ...manifest, ...overrides, name };
  const defs = new Map<string, ArrayBuffer>(merged.synthdefs.map((d) => [d, new ArrayBuffer(4)]));
  return new Program(transport, "cmp_123", name, merged, defs);
}

describe("Program playback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uploads defs, syncs, replays setup in order, then pumps the lookahead window", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const program = makeProgram(transport);

    await program.play();

    expect(h.engine.loadSynthdefFromData).toHaveBeenCalledTimes(2);
    expect(h.sonic.sync).toHaveBeenCalledTimes(1);
    expect(h.engine.stop).toHaveBeenCalledTimes(1);

    expect(h.sends).toEqual([
      ["/g_new", 10, 0, 0],
      ["/g_new", 20, 3, 10],
      ["/s_new", "pad", 100, 1, 10, "amp", 0.5],
    ]);

    /*
     * Anchor: t0 = 100 + 0.5 (start delay). Lookahead is 2s, so the
     * groups at beat 0 (0s) and beat 2 (1s) are in flight; beat 6 (3s)
     * is beyond the horizon.
     */
    expect(h.bundles.map((b) => b.timeTag)).toEqual([100.5, 101.5]);
    expect(h.bundles[0].packets).toEqual([["/s_new", "bass", 100000, 1, 10]]);
    expect(program.isPlaying()).toBe(true);
  });

  it("does not re-upload defs when replaying the same program", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const program = makeProgram(transport);

    await program.play();
    await program.play();

    expect(h.engine.loadSynthdefFromData).toHaveBeenCalledTimes(2);
  });

  it("throws when a def's bytes are missing from the handle", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const program = new Program(transport, "cmp_123", "seeker", manifest, new Map());

    await expect(program.play()).rejects.toThrow(SynthError);
  });

  it("restores cumulative stem state when starting mid-piece", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const program = makeProgram(transport);

    await program.seek(4);

    /* Setup first, then the folded stem state: amp advanced by beat 2. */
    expect(h.sends).toEqual([
      ["/g_new", 10, 0, 0],
      ["/g_new", 20, 3, 10],
      ["/s_new", "pad", 100, 1, 10, "amp", 0.5],
      ["/n_set", 100, "amp", 0.8],
    ]);

    /*
     * Anchor places beat 4 at now + START_DELAY: t0 = 100.5 - 4*0.5 =
     * 98.5. Groups before beat 4 are dropped (no ghost onsets); beat 6
     * maps to 98.5 + 3 = 101.5, inside the 2s lookahead.
     */
    expect(h.bundles.map((b) => b.timeTag)).toEqual([101.5]);
    expect(h.bundles[0].packets).toEqual([["/n_set", 100, "amp", 0.2]]);
  });

  it("re-anchors in place on seek while playing: purge, stem restore, no teardown", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const program = makeProgram(transport);

    await program.play();
    h.sends.length = 0;
    h.bundles.length = 0;

    await program.seek(4);

    expect(h.sonic.purge).toHaveBeenCalledTimes(1);
    /* Graph kept: no group frees, only the stem restore. */
    expect(h.sends).toEqual([["/n_set", 100, "amp", 0.8]]);

    /* Seek anchor: t0 = 100 + 0.12 - 2 = 98.12; beat 6 -> 101.12. */
    expect(h.bundles.map((b) => b.timeTag)).toEqual([101.12]);
    expect(program.isPlaying()).toBe(true);
  });

  it("stop() tears the graph down after a purge and emits a final idle snapshot", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const program = makeProgram(transport);
    const snapshots: ProgramProgress[] = [];
    program.subscribe((p) => snapshots.push(p));

    await program.play();
    h.sends.length = 0;

    await program.stop();

    expect(h.sonic.purge).toHaveBeenCalled();
    expect(h.sends).toEqual([
      ["/g_deepFree", 10],
      ["/g_deepFree", 20],
      ["/n_free", 10, 20],
    ]);
    expect(program.isPlaying()).toBe(false);

    const last = snapshots[snapshots.length - 1];
    expect(last.state).toBe("idle");
    expect(last.beat).toBe(0);
  });

  it("stop() from a non-active handle is a no-op", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const active = makeProgram(transport, {}, "active_piece");
    const bystander = makeProgram(transport, {}, "bystander");

    await active.play();
    h.sends.length = 0;

    await bystander.stop();

    expect(h.sends).toEqual([]);
    expect(active.isPlaying()).toBe(true);
  });

  it("switching programs re-uploads the next defs and frees orphaned names", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const first = makeProgram(transport, {}, "first_piece");
    const second = makeProgram(transport, { synthdefs: ["pad", "kick"] }, "second_piece");

    await first.play();
    expect(h.engine.loadSynthdefFromData).toHaveBeenCalledTimes(2);

    await second.play();

    /* pad + kick re-uploaded; bass no longer referenced -> freed. */
    expect(h.engine.loadSynthdefFromData).toHaveBeenCalledTimes(4);
    expect(h.engine.freeSynthDefs).toHaveBeenCalledWith(["bass"]);
    expect(first.isPlaying()).toBe(false);
    expect(second.isPlaying()).toBe(true);

    /* The first program's graph was torn down before the second's setup. */
    const deepFreeIndex = h.sends.findIndex((p) => p[0] === "/g_deepFree");
    const secondSetupIndex = h.sends.findIndex(
      (p, i) => p[0] === "/g_new" && i > deepFreeIndex && deepFreeIndex >= 0
    );
    expect(deepFreeIndex).toBeGreaterThanOrEqual(0);
    expect(secondSetupIndex).toBeGreaterThan(deepFreeIndex);
  });

  it("finishes naturally at the end of the piece, freeing only the group nodes", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const program = makeProgram(transport);
    const snapshots: ProgramProgress[] = [];
    program.subscribe((p) => snapshots.push(p));

    await program.play();
    h.sends.length = 0;

    /* Past the end: 8 beats at 0.5s + 0.5s start delay = 104.5. */
    h.setClock(105);
    vi.advanceTimersByTime(100);

    expect(program.isPlaying()).toBe(false);
    /* Manifest teardown already silenced synths; only groups are freed. */
    expect(h.sends).toEqual([["/n_free", 10, 20]]);

    const last = snapshots[snapshots.length - 1];
    expect(last.state).toBe("idle");
    expect(last.beat).toBe(manifest.durationBeats);
    expect(last.progress).toBe(1);
  });

  it("emits progress snapshots with section info while playing", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const program = makeProgram(transport);
    const snapshots: ProgramProgress[] = [];
    program.subscribe((p) => snapshots.push(p));

    /* Immediate snapshot on subscribe, before playback. */
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      state: "idle",
      beat: 0,
      durationBeats: 8,
      durationSec: 4,
      sectionCount: 2,
    });

    await program.play();

    /* 2.6s after t0: beat 4.2, inside "outro". */
    h.setClock(103.1);
    vi.advanceTimersByTime(100);

    const last = snapshots[snapshots.length - 1];
    expect(last.state).toBe("playing");
    expect(last.beat).toBeCloseTo(5.2, 1);
    expect(last.sectionName).toBe("outro");
    expect(last.sectionIndex).toBe(1);
  });

  it("notifies the outgoing program's subscribers when another takes over", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const first = makeProgram(transport, {}, "first_piece");
    const second = makeProgram(transport, { synthdefs: ["pad", "kick"] }, "second_piece");
    const firstSnapshots: ProgramProgress[] = [];
    first.subscribe((p) => firstSnapshots.push(p));

    await first.play();
    await second.play();

    const last = firstSnapshots[firstSnapshots.length - 1];
    expect(last.state).toBe("idle");
    expect(second.isPlaying()).toBe(true);
  });

  it("interrupt() (single-synth takeover) stops playback synchronously", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const program = makeProgram(transport);

    await program.play();
    transport.interrupt();

    expect(program.isPlaying()).toBe(false);

    /* The queued teardown still runs (async) and frees the graph. */
    await vi.waitFor(() => {
      expect(h.sends.some((p) => p[0] === "/g_deepFree")).toBe(true);
    });
  });

  it("seekToSection jumps to the section's start beat and rejects bad indices", async () => {
    const h = makeHarness(100);
    const transport = new ProgramTransport(h.engine);
    const program = makeProgram(transport);

    await program.play();
    h.bundles.length = 0;

    await program.seekToSection(1);
    /* Section 1 starts at beat 4 -> same anchor math as seek(4). */
    expect(h.bundles.map((b) => b.timeTag)).toEqual([101.12]);

    await expect(program.seekToSection(9)).rejects.toThrow(SynthError);
  });

  it("exposes manifest-derived metadata on the handle", () => {
    const transport = new ProgramTransport(makeHarness().engine);
    const program = makeProgram(transport);

    expect(program.name).toBe("seeker");
    expect(program.compositionId).toBe("cmp_123");
    expect(program.title).toBe("Seeker");
    expect(program.bpm).toBe(120);
    expect(program.durationBeats).toBe(8);
    expect(program.durationSec).toBe(4);
    expect(program.sections.map((s) => s.name)).toEqual(["intro", "outro"]);
  });
});
