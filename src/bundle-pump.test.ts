/**
 * Tests for the BundlePump scheduling core. A fake engine exposes a
 * controllable superClock and records every encoded bundle, so the tests
 * can assert the two properties consumers rely on: only the lookahead
 * window is in flight at once, and (re)starting against an existing anchor
 * skips groups already in the past -- the "re-anchor" half of the
 * stop/purge/restart cancellation model.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BundlePump, type PumpGroup, type OscPacket } from "./bundle-pump.js";
import type { SuperSonic } from "supersonic-scsynth";

interface SentBundle {
  timeTag: number;
  packets: OscPacket[];
}

function makeHarness(startClock = 100) {
  let clockNow = startClock;
  const sent: SentBundle[] = [];

  const engine = {
    superClock: { now: () => clockNow },
    sendOSC: (encoded: Uint8Array) => {
      sent.push(pending.get(encoded)!);
    },
  } as unknown as SuperSonic;

  /*
   * The encoder returns opaque bytes; to assert on content we hand out
   * unique arrays and remember what each one encoded.
   */
  const pending = new Map<Uint8Array, SentBundle>();
  const encoder = {
    encodeBundle: (timeTag: number, packets: OscPacket[]) => {
      const bytes = new Uint8Array([pending.size]);
      pending.set(bytes, { timeTag, packets });
      return bytes;
    },
  };

  return {
    engine,
    encoder,
    sent,
    setClock: (value: number) => {
      clockNow = value;
    },
  };
}

function groupAt(timeSec: number, ...args: Array<string | number>): PumpGroup {
  return { timeSec, packets: [["/n_set", 1000, ...args]] };
}

describe("BundlePump", () => {
  let pump: BundlePump;

  beforeEach(() => {
    vi.useFakeTimers();
    pump = new BundlePump();
  });

  afterEach(() => {
    pump.stop();
    vi.useRealTimers();
  });

  it("schedules only the lookahead window, then pumps the rest as time advances", () => {
    const h = makeHarness(100);
    const groups = [groupAt(0.5), groupAt(1.5), groupAt(5), groupAt(9)];

    pump.start({ engine: h.engine, encoder: h.encoder, t0: 100, groups });

    /* Lookahead is 2s: groups at 0.5 and 1.5 go out immediately. */
    expect(h.sent.map((b) => b.timeTag)).toEqual([100.5, 101.5]);
    expect(pump.isActive()).toBe(true);

    h.setClock(103.5);
    vi.advanceTimersByTime(250);
    expect(h.sent.map((b) => b.timeTag)).toEqual([100.5, 101.5, 105]);

    h.setClock(107.5);
    vi.advanceTimersByTime(250);
    expect(h.sent.map((b) => b.timeTag)).toEqual([100.5, 101.5, 105, 109]);
    expect(pump.isActive()).toBe(false);
  });

  it("emits timestamped bundles anchored at t0 with the group's packets", () => {
    const h = makeHarness(50);
    pump.start({
      engine: h.engine,
      encoder: h.encoder,
      t0: 50.25,
      groups: [groupAt(1, "amp", 0.5)],
    });

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].timeTag).toBeCloseTo(51.25);
    expect(h.sent[0].packets).toEqual([["/n_set", 1000, "amp", 0.5]]);
  });

  it("skips groups already in the past on start (re-anchor after purge)", () => {
    const h = makeHarness(100);
    const groups = [groupAt(0), groupAt(1), groupAt(2), groupAt(3)];

    /* The piece started 2.5s ago; only future groups may fire. */
    pump.start({ engine: h.engine, encoder: h.encoder, t0: 97.5, groups });

    expect(h.sent.map((b) => b.timeTag)).toEqual([100.5]);
  });

  it("admits a group at the current instant despite small clock skew", () => {
    const h = makeHarness(100);
    pump.start({
      engine: h.engine,
      encoder: h.encoder,
      t0: 99.99,
      groups: [groupAt(0), groupAt(1)],
    });

    /* t0+0 is 10ms in the past -- inside the margin, so it still fires. */
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0].timeTag).toBeCloseTo(99.99, 6);
    expect(h.sent[1].timeTag).toBeCloseTo(100.99, 6);
  });

  it("stop() halts future scheduling and start() supersedes a previous run", () => {
    const h = makeHarness(100);
    pump.start({
      engine: h.engine,
      encoder: h.encoder,
      t0: 100,
      groups: [groupAt(1), groupAt(10)],
    });
    expect(h.sent).toHaveLength(1);

    pump.stop();
    expect(pump.isActive()).toBe(false);
    h.setClock(109);
    vi.advanceTimersByTime(1000);
    expect(h.sent).toHaveLength(1);

    /* A filtered restart against the same anchor picks up cleanly. */
    pump.start({
      engine: h.engine,
      encoder: h.encoder,
      t0: 100,
      groups: [groupAt(1), groupAt(10)],
    });
    expect(h.sent.map((b) => b.timeTag)).toEqual([101, 110]);
  });
});
