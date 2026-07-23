/**
 * Tests for the vendored program-manifest helpers. These are ports of the
 * first-party player's manifest math and the cases here mirror its suite:
 * if a behavior diverges between the app and the SDK, one of these fails.
 */
import { describe, it, expect } from "vitest";
import {
  foldControlPairs,
  groupEventsByBeat,
  sectionIndexAtBeat,
  stemControlStateAtBeat,
} from "./program-manifest.js";
import type { ProgramManifest, ProgramSection } from "./types.js";

describe("groupEventsByBeat", () => {
  it("packs events that share an exact beat into one bundle, preserving order", () => {
    const groups = groupEventsByBeat([
      { beat: 0, cmd: "/s_new", args: ["avPrism", 100000, 1, 10] },
      { beat: 0, cmd: "/n_setn", args: [100000, "freqs", 2, 110, 220] },
      { beat: 4, cmd: "/s_new", args: ["avKick", 100001, 1, 10] },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].beat).toBe(0);
    expect(groups[0].packets).toEqual([
      ["/s_new", "avPrism", 100000, 1, 10],
      ["/n_setn", 100000, "freqs", 2, 110, 220],
    ]);
    expect(groups[1].beat).toBe(4);
    expect(groups[1].packets).toEqual([["/s_new", "avKick", 100001, 1, 10]]);
  });

  it("keeps distinct consecutive beats in separate groups", () => {
    const groups = groupEventsByBeat([
      { beat: 0, cmd: "/n_set", args: [100, "amp", 0.5] },
      { beat: 0.5, cmd: "/n_set", args: [100, "amp", 0.6] },
      { beat: 0.5, cmd: "/n_set", args: [101, "amp", 0.7] },
    ]);
    expect(groups.map((g) => g.beat)).toEqual([0, 0.5]);
    expect(groups[1].packets).toHaveLength(2);
  });

  it("returns no groups for an empty event list", () => {
    expect(groupEventsByBeat([])).toEqual([]);
  });

  /*
   * The capture log records call order, not time order: a bar loop emits
   * hit(3.75) before the next statement's hit(0). The pump stalls on the
   * first group past its lookahead, so out-of-order groups were sent past
   * their timestamps and scsynth played them late (audibly off-grid subs).
   */
  it("time-orders out-of-order capture events, keeping same-beat capture order", () => {
    const groups = groupEventsByBeat([
      { beat: 3.75, cmd: "/s_new", args: ["bass", 100001, 1, 10] },
      { beat: 0, cmd: "/s_new", args: ["sub", 100002, 1, 10] },
      { beat: 0, cmd: "/n_setn", args: [100002, "freqs", 2, 110, 220] },
      { beat: 2.5, cmd: "/s_new", args: ["blip", 100003, 1, 10] },
    ]);

    expect(groups.map((g) => g.beat)).toEqual([0, 2.5, 3.75]);
    // Same-beat events stay in capture order: /s_new before its /n_setn.
    expect(groups[0].packets).toEqual([
      ["/s_new", "sub", 100002, 1, 10],
      ["/n_setn", 100002, "freqs", 2, 110, 220],
    ]);
  });
});

describe("sectionIndexAtBeat", () => {
  const sections: ProgramSection[] = [
    { name: "I. IGNITION", beat: 0 },
    { name: "II. VECTOR", beat: 16 },
    { name: "III. LANTERN", beat: 48 },
  ];

  it("returns -1 before the first section starts", () => {
    expect(sectionIndexAtBeat(sections, -1)).toBe(-1);
  });

  it("returns the current section at its exact start beat", () => {
    expect(sectionIndexAtBeat(sections, 0)).toBe(0);
    expect(sectionIndexAtBeat(sections, 16)).toBe(1);
    expect(sectionIndexAtBeat(sections, 48)).toBe(2);
  });

  it("returns the last section whose start is before the beat", () => {
    expect(sectionIndexAtBeat(sections, 10)).toBe(0);
    expect(sectionIndexAtBeat(sections, 47.9)).toBe(1);
    expect(sectionIndexAtBeat(sections, 200)).toBe(2);
  });

  it("returns -1 when there are no sections", () => {
    expect(sectionIndexAtBeat([], 10)).toBe(-1);
  });
});

describe("stemControlStateAtBeat", () => {
  const manifest: ProgramManifest = {
    format: 1,
    name: "seeker",
    title: "Seeker",
    description: "",
    bpm: 120,
    beatsPerBar: 4,
    durationBeats: 64,
    synthdefs: ["pad", "bass"],
    buses: [],
    sections: [],
    setup: [
      { cmd: "/g_new", args: [10, 0, 0] },
      { cmd: "/s_new", args: ["pad", 100, 1, 10, "amp", 0.5, "cutoff", 1000] },
      { cmd: "/s_new", args: ["bass", 101, 1, 10, "amp", 0.2] },
    ],
    events: [
      { beat: 2, cmd: "/s_new", args: ["blip", -1, 1, 10, "freq", 440] },
      { beat: 4, cmd: "/n_set", args: [100, "amp", 0.8] },
      { beat: 6, cmd: "/n_set", args: [100, "cutoff", 2000] },
      { beat: 8, cmd: "/n_set", args: [101, "amp", 0.6] },
      { beat: 12, cmd: "/n_set", args: [100, "amp", 0.3] },
      { beat: 20, cmd: "/n_set", args: [999, "amp", 9] },
    ],
  };

  it("returns the setup values at beat 0 (no events have fired yet)", () => {
    expect(stemControlStateAtBeat(manifest, 0)).toEqual([
      ["/n_set", 100, "amp", 0.5, "cutoff", 1000],
      ["/n_set", 101, "amp", 0.2],
    ]);
  });

  it("accumulates every /n_set strictly before the beat, last value winning", () => {
    /* At beat 10: amp took 0.8 (beat 4), cutoff 2000 (beat 6); the 0.3 at
       beat 12 is in the future. Bass took 0.6 at beat 8. */
    expect(stemControlStateAtBeat(manifest, 10)).toEqual([
      ["/n_set", 100, "amp", 0.8, "cutoff", 2000],
      ["/n_set", 101, "amp", 0.6],
    ]);
  });

  it("excludes an /n_set landing exactly on the beat (the pump replays it)", () => {
    /* beat 4's amp=0.8 is not yet folded in at exactly beat 4. */
    expect(stemControlStateAtBeat(manifest, 4)).toEqual([
      ["/n_set", 100, "amp", 0.5, "cutoff", 1000],
      ["/n_set", 101, "amp", 0.2],
    ]);
  });

  it("ignores /n_set to nodes the setup never created and transient /s_new hits", () => {
    const state = stemControlStateAtBeat(manifest, 40);
    expect(state.some((packet) => packet[1] === 999)).toBe(false);
    expect(state).toEqual([
      ["/n_set", 100, "amp", 0.3, "cutoff", 2000],
      ["/n_set", 101, "amp", 0.6],
    ]);
  });
});

describe("foldControlPairs", () => {
  it("folds [control, value] pairs from the given offset, last value winning", () => {
    const target = new Map<string, number>();
    // /s_new shape: [defName, nodeID, addAction, targetID, ...pairs]
    foldControlPairs(target, ["pad", 100, 1, 10, "amp", 0.5, "cutoff", 1000, "amp", 0.9], 4);
    expect([...target]).toEqual([
      ["amp", 0.9],
      ["cutoff", 1000],
    ]);
  });

  it("reads /n_set pairs from offset 1", () => {
    const target = new Map<string, number>();
    foldControlPairs(target, [100, "amp", 0.3, "pan", -0.2], 1);
    expect([...target]).toEqual([
      ["amp", 0.3],
      ["pan", -0.2],
    ]);
  });

  it("skips non-conforming entries and a dangling odd trailing arg", () => {
    const target = new Map<string, number>();
    // A non-numeric value and a trailing key with no value are both ignored.
    foldControlPairs(target, [100, "amp", 0.4, "route", "busA", "gain", 2, "orphan"], 1);
    expect([...target]).toEqual([
      ["amp", 0.4],
      ["gain", 2],
    ]);
  });
});
