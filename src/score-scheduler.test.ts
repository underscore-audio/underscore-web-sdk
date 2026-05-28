/**
 * Tests for ScoreScheduler interpolation behaviour.
 *
 * Drives the scheduler with vitest fake timers and asserts on the
 * sequence of onTick payloads. Step events should still fire
 * exactly once; linear/exp events should emit intermediate ticks
 * at ~33 Hz and land on the target value at `tMs`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScoreScheduler } from "./score-scheduler.js";
import type { SynthScore } from "./types.js";

const TICK_MS = 30;

describe("ScoreScheduler", () => {
  let scheduler: ScoreScheduler;
  let onTick: ReturnType<typeof vi.fn>;

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

      scheduler.start({ score, onTick });
      vi.advanceTimersByTime(2000);

      const calls = onTick.mock.calls.map((c) => c[0]);
      expect(calls).toEqual([{ amp: 0.1 }, { cutoff: 3000 }, { amp: 0 }]);
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
    it("ramps from initialValues to target with intermediate ticks", () => {
      const score: SynthScore = {
        totalDurationSec: 1,
        events: [{ tMs: 300, params: { amp: 1.0 }, curve: "linear" }],
      };

      scheduler.start({ score, onTick, initialValues: { amp: 0 } });
      vi.advanceTimersByTime(300);

      /*
       * Expect ticks at 30, 60, 90, ..., 270 (9 intermediates) plus
       * the final tick at 300. Values should grow monotonically and
       * the last call must equal the target exactly.
       */
      const calls = onTick.mock.calls.map((c) => c[0] as Record<string, number>);
      expect(calls.length).toBe(10);

      for (let i = 1; i < calls.length; i++) {
        expect(calls[i].amp).toBeGreaterThan(calls[i - 1].amp);
      }

      expect(calls[calls.length - 1]).toEqual({ amp: 1.0 });

      const midpoint = calls.find((c, i) => Math.abs(((i + 1) * TICK_MS) / 300 - 0.5) < 0.05);
      expect(midpoint).toBeDefined();
      expect(midpoint!.amp).toBeCloseTo(0.5, 1);
    });

    it("ramps from prior event values rather than initialValues", () => {
      const score: SynthScore = {
        totalDurationSec: 2,
        events: [
          { tMs: 0, params: { freq: 100 } },
          { tMs: 600, params: { freq: 700 }, curve: "linear" },
        ],
      };

      scheduler.start({ score, onTick, initialValues: { freq: 0 } });
      vi.advanceTimersByTime(600);

      const calls = onTick.mock.calls.map((c) => c[0] as Record<string, number>);

      expect(calls[0]).toEqual({ freq: 100 });
      expect(calls[calls.length - 1]).toEqual({ freq: 700 });

      /*
       * Ramp runs from 0ms (post-step event) to 600ms, so the tick
       * around 300ms (halfway) should sit near the midpoint of
       * 100..700 = 400.
       */
      const halfwayCall = calls.find((_c, i) => i > 0 && i * TICK_MS >= 290 && i * TICK_MS <= 310);
      expect(halfwayCall).toBeDefined();
      expect(halfwayCall!.freq).toBeCloseTo(400, 0);
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

      const intermediate = onTick.mock.calls
        .map((c) => c[0] as Record<string, number>)
        .filter((p) => !("cutoff" in p));

      expect(intermediate.length).toBeGreaterThan(0);
      for (const p of intermediate) {
        expect(Object.keys(p)).toEqual(["amp"]);
      }
    });

    it("snaps to target when no prior value is known", () => {
      const score: SynthScore = {
        totalDurationSec: 1,
        events: [{ tMs: 300, params: { newParam: 5 }, curve: "linear" }],
      };

      scheduler.start({ score, onTick });
      vi.advanceTimersByTime(300);

      const calls = onTick.mock.calls.map((c) => c[0] as Record<string, number>);
      for (const c of calls) {
        expect(c.newParam).toBe(5);
      }
      expect(calls[calls.length - 1]).toEqual({ newParam: 5 });
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

      const calls = onTick.mock.calls.map((c) => c[0] as Record<string, number>);
      const halfway = calls.find((_c, i) => (i + 1) * TICK_MS === 150);

      expect(halfway).toBeDefined();
      const expectedHalfway = 200 * Math.pow(800 / 200, 0.5);
      expect(halfway!.freq).toBeCloseTo(expectedHalfway, 1);

      expect(calls[calls.length - 1]).toEqual({ freq: 800 });
    });

    it("falls back to linear when start is zero", () => {
      const score: SynthScore = {
        totalDurationSec: 1,
        events: [{ tMs: 300, params: { amp: 1 }, curve: "exp" }],
      };

      scheduler.start({ score, onTick, initialValues: { amp: 0 } });
      vi.advanceTimersByTime(300);

      const calls = onTick.mock.calls.map((c) => c[0] as Record<string, number>);
      const halfway = calls.find((_c, i) => (i + 1) * TICK_MS === 150);

      expect(halfway).toBeDefined();
      expect(halfway!.amp).toBeCloseTo(0.5, 1);
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

      const calls = onTick.mock.calls.map((c) => c[0] as Record<string, number>);

      const stepJump = calls.find((c) => c.cutoff === 5000);
      expect(stepJump).toBeDefined();

      const ampRampValues = calls.filter((c) => "amp" in c && !("cutoff" in c));
      expect(ampRampValues.length).toBeGreaterThan(1);

      const cutoffRampValues = calls.filter(
        (c) => "cutoff" in c && c.cutoff !== 5000 && c.cutoff !== 1000
      );
      expect(cutoffRampValues.length).toBeGreaterThan(0);

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

      scheduler.start({ score: first, onTick });
      vi.advanceTimersByTime(200);
      scheduler.start({ score: second, onTick });
      vi.advanceTimersByTime(2000);

      const calls = onTick.mock.calls.map((c) => c[0]);
      expect(calls).toEqual([{ amp: 0.5 }]);
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

      const calls = onTick.mock.calls.map((c) => c[0]);
      expect(calls).toContainEqual({ amp: 0.9 });
    });

    it("handles empty events array", () => {
      const score: SynthScore = { totalDurationSec: 1, events: [] };
      scheduler.start({ score, onTick });
      vi.advanceTimersByTime(2000);
      expect(onTick).not.toHaveBeenCalled();
    });
  });
});
