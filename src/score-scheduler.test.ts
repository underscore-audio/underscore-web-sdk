/**
 * Tests for ScoreScheduler interpolation behaviour.
 *
 * These tests assert the observable contract a downstream consumer
 * cares about (final landing value matches the score, ramps move
 * monotonically from prior value to target, step events still fire
 * exactly once, cancel really stops further work) without pinning
 * the internal tick cadence. The exact number of intermediate
 * `onTick` calls per ramp is an implementation detail that should be
 * free to change.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScoreScheduler } from "./score-scheduler.js";
import type { SynthScore } from "./types.js";

describe("ScoreScheduler", () => {
  let scheduler: ScoreScheduler;
  let onTick: ReturnType<typeof vi.fn>;

  function callsAt(): Record<string, number>[] {
    return onTick.mock.calls.map((c) => c[0] as Record<string, number>);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new ScoreScheduler();
    onTick = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("step curve (default)", () => {
    it("fires events exactly at tMs without intermediate ticks", () => {
      const score: SynthScore = {
        totalDurationSec: 2,
        events: [
          { tMs: 0, params: { amp: 0.1 } },
          { tMs: 1000, params: { cutoff: 3000 } },
          { tMs: 2000, params: { amp: 0 } },
        ],
      };

      scheduler.start({ score, onTick, initialValues: { amp: 0, cutoff: 1000 } });
      vi.advanceTimersByTime(2000);

      expect(callsAt()).toEqual([{ amp: 0.1 }, { cutoff: 3000 }, { amp: 0 }]);
    });

    it("treats missing curve as step", () => {
      const score: SynthScore = {
        totalDurationSec: 1,
        events: [{ tMs: 1000, params: { amp: 0.5 } }],
      };

      scheduler.start({ score, onTick, initialValues: { amp: 0 } });
      vi.advanceTimersByTime(1000);

      expect(onTick).toHaveBeenCalledTimes(1);
      expect(onTick).toHaveBeenCalledWith({ amp: 0.5 });
    });
  });

  describe("linear curve", () => {
    it("ramps monotonically from initialValues to target and lands exactly on target", () => {
      const score: SynthScore = {
        totalDurationSec: 1,
        events: [{ tMs: 300, params: { amp: 1.0 }, curve: "linear" }],
      };

      scheduler.start({ score, onTick, initialValues: { amp: 0 } });
      vi.advanceTimersByTime(300);

      const calls = callsAt();
      expect(calls.length).toBeGreaterThan(1);
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i].amp).toBeGreaterThan(calls[i - 1].amp);
        expect(calls[i].amp).toBeLessThanOrEqual(1);
      }
      expect(calls[calls.length - 1]).toEqual({ amp: 1.0 });
    });

    it("ramps from prior event's value rather than initialValues", () => {
      const score: SynthScore = {
        totalDurationSec: 2,
        events: [
          { tMs: 0, params: { freq: 100 } },
          { tMs: 600, params: { freq: 700 }, curve: "linear" },
        ],
      };

      scheduler.start({ score, onTick, initialValues: { freq: 0 } });
      vi.advanceTimersByTime(600);

      const calls = callsAt();
      expect(calls[0]).toEqual({ freq: 100 });
      expect(calls[calls.length - 1]).toEqual({ freq: 700 });

      const intermediate = calls.slice(1, -1);
      expect(intermediate.length).toBeGreaterThan(0);
      for (const c of intermediate) {
        expect(c.freq).toBeGreaterThan(100);
        expect(c.freq).toBeLessThan(700);
      }
    });

    it("only ramps params present in the event payload", () => {
      const score: SynthScore = {
        totalDurationSec: 1,
        events: [
          { tMs: 0, params: { amp: 0.2, cutoff: 1000 } },
          { tMs: 300, params: { amp: 0.8 }, curve: "linear" },
        ],
      };

      scheduler.start({ score, onTick, initialValues: { amp: 0, cutoff: 1000 } });
      vi.advanceTimersByTime(300);

      const intermediate = callsAt().filter((p) => !("cutoff" in p));
      expect(intermediate.length).toBeGreaterThan(0);
      for (const p of intermediate) {
        expect(Object.keys(p)).toEqual(["amp"]);
      }
    });
  });

  describe("exp curve", () => {
    it("follows start * (end/start)^t for same-sign nonzero endpoints", () => {
      const score: SynthScore = {
        totalDurationSec: 1,
        events: [{ tMs: 300, params: { freq: 800 }, curve: "exp" }],
      };

      scheduler.start({ score, onTick, initialValues: { freq: 200 } });
      vi.advanceTimersByTime(300);

      const calls = callsAt();
      expect(calls.length).toBeGreaterThan(1);

      /*
       * Exponential interpolation from 200 -> 800 means at any
       * progress t in [0, 1], value = 200 * 4^t. That's strictly
       * convex (sub-linear at small t, super-linear at large t),
       * which gives us a no-implementation-pinning shape check:
       * the geometric mean of the endpoints (400) is hit BEFORE
       * the wall-clock midpoint, unlike linear interpolation.
       */
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i].freq).toBeGreaterThan(calls[i - 1].freq);
      }
      const reach400Idx = calls.findIndex((c) => c.freq >= 400);
      expect(reach400Idx).toBeGreaterThan(0);
      expect(reach400Idx).toBeLessThan(Math.floor(calls.length / 2) + 1);
      expect(calls[calls.length - 1]).toEqual({ freq: 800 });
    });

    it("falls back to linear when start is zero", () => {
      const score: SynthScore = {
        totalDurationSec: 1,
        events: [{ tMs: 300, params: { amp: 1 }, curve: "exp" }],
      };

      scheduler.start({ score, onTick, initialValues: { amp: 0 } });
      vi.advanceTimersByTime(300);

      const calls = callsAt();
      expect(calls.length).toBeGreaterThan(1);
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i].amp).toBeGreaterThan(calls[i - 1].amp);
      }
      expect(calls[calls.length - 1]).toEqual({ amp: 1 });
    });
  });

  describe("mixed-curve scores", () => {
    it("interleaves ramps and step jumps in tMs order", () => {
      const score: SynthScore = {
        totalDurationSec: 3,
        events: [
          { tMs: 0, params: { amp: 0 } },
          { tMs: 300, params: { amp: 1 }, curve: "linear" },
          { tMs: 600, params: { cutoff: 5000 } },
          { tMs: 900, params: { cutoff: 1000 }, curve: "linear" },
        ],
      };

      scheduler.start({ score, onTick, initialValues: { amp: 0, cutoff: 5000 } });
      vi.advanceTimersByTime(900);

      const calls = callsAt();
      expect(calls).toContainEqual({ cutoff: 5000 });
      expect(calls.filter((c) => "amp" in c && !("cutoff" in c)).length).toBeGreaterThan(1);
      expect(
        calls.filter((c) => "cutoff" in c && c.cutoff !== 5000 && c.cutoff !== 1000).length
      ).toBeGreaterThan(0);
      expect(calls[calls.length - 1]).toEqual({ cutoff: 1000 });
    });
  });

  describe("cancel()", () => {
    it("stops further ticks during a ramp", () => {
      const score: SynthScore = {
        totalDurationSec: 1,
        events: [{ tMs: 600, params: { amp: 1 }, curve: "linear" }],
      };

      scheduler.start({ score, onTick, initialValues: { amp: 0 } });
      vi.advanceTimersByTime(150);
      const callsBeforeCancel = onTick.mock.calls.length;
      expect(callsBeforeCancel).toBeGreaterThan(0);

      scheduler.cancel();
      vi.advanceTimersByTime(10_000);

      expect(onTick.mock.calls.length).toBe(callsBeforeCancel);
    });

    it("calling start again cancels prior schedule", () => {
      const first: SynthScore = {
        totalDurationSec: 1,
        events: [{ tMs: 1000, params: { amp: 1 } }],
      };
      const second: SynthScore = {
        totalDurationSec: 1,
        events: [{ tMs: 500, params: { amp: 0.5 } }],
      };

      scheduler.start({ score: first, onTick, initialValues: { amp: 0 } });
      vi.advanceTimersByTime(200);
      scheduler.start({ score: second, onTick, initialValues: { amp: 0 } });
      vi.advanceTimersByTime(2000);

      expect(callsAt()).toEqual([{ amp: 0.5 }]);
    });
  });

  describe("degenerate inputs", () => {
    it("handles zero-duration ramp by snapping to target", () => {
      const score: SynthScore = {
        totalDurationSec: 1,
        events: [
          { tMs: 100, params: { amp: 0.3 } },
          { tMs: 100, params: { amp: 0.9 }, curve: "linear" },
        ],
      };

      scheduler.start({ score, onTick, initialValues: { amp: 0 } });
      vi.advanceTimersByTime(100);

      expect(callsAt()).toContainEqual({ amp: 0.9 });
    });

    it("handles empty events array", () => {
      const score: SynthScore = { totalDurationSec: 1, events: [] };
      scheduler.start({ score, onTick, initialValues: {} });
      vi.advanceTimersByTime(2000);
      expect(onTick).not.toHaveBeenCalled();
    });
  });
});
