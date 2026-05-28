/**
 * Score scheduler used by `Synth.play()` / `Synth.stop()`.
 *
 * Walks `SynthScore.events` on start and fires their `params`
 * payloads via the caller-provided `onTick` callback. Each event
 * declares an interpolation `curve` for the transition into it:
 *
 *   - `step` (default): jump to the new values exactly at `tMs`.
 *   - `linear`: ramp each numeric param from its previous value at
 *     the prior event (or the synth default at t=0) to the new
 *     value, emitting intermediate `onTick` calls at a fixed
 *     cadence so SuperCollider parameters change smoothly instead
 *     of stepping.
 *   - `exp`: same shape but with an exponential curve --
 *     `start * (end/start)^t`, which matches SuperCollider's
 *     `\exp` envelope semantics and is the right curve for
 *     frequency- and amplitude-like params. Falls back to linear
 *     when one of the endpoints is zero or the endpoints have
 *     opposite signs (where true exp interpolation is undefined).
 *
 * Scheduling uses `setTimeout` against `performance.now()`. Score
 * events are coarse (50ms+ practical resolution -- knob automation,
 * filter sweeps, fades), well above the main-thread queue jitter.
 * Ramp ticks fire at `RAMP_TICK_MS` (~33Hz) which is plenty for
 * audible smoothness on the kinds of slow morphs scores produce
 * without flooding the OSC bus.
 */

import type { ScoreEvent, SynthScore } from "./types.js";

export interface ScoreSchedulerOptions {
  score: SynthScore;
  onTick: (params: Record<string, number>) => void;
  /**
   * Starting values for every param the score may move. Typically
   * the synth's `ParamMetadata.default` map, supplied by
   * `Synth.play()`. Score events that reference params not present
   * here are a contract violation upstream and will produce NaN
   * ticks; the scheduler does not paper over that silently.
   */
  initialValues: Record<string, number>;
}

const RAMP_TICK_MS = 30;

export class ScoreScheduler {
  private timers: ReturnType<typeof setTimeout>[] = [];

  start(opts: ScoreSchedulerOptions): void {
    this.cancel();
    const t0 = performance.now();

    /*
     * Walk events in order, threading a running `currentValues` map
     * forward so each event's ramp starts from whatever the prior
     * event left behind. We compute interpolation snapshots up front
     * (synchronously) and only schedule the resulting timers; ramp
     * math never runs inside a setTimeout callback so cancel() is
     * trivially safe.
     */
    const currentValues: Record<string, number> = { ...opts.initialValues };
    let prevTMs = 0;

    for (const event of opts.score.events) {
      const curve = event.curve ?? "step";
      const eventTMs = Math.max(0, event.tMs);

      if (curve === "step" || eventTMs <= prevTMs) {
        this.scheduleAt(eventTMs, t0, () => opts.onTick(event.params));
      } else {
        this.scheduleRamp(t0, prevTMs, eventTMs, currentValues, event, curve, opts.onTick);
      }

      Object.assign(currentValues, event.params);
      prevTMs = eventTMs;
    }
  }

  cancel(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private scheduleAt(absoluteMs: number, t0: number, fn: () => void): void {
    const delayMs = Math.max(0, absoluteMs - (performance.now() - t0));
    const timer = setTimeout(fn, delayMs);
    this.timers.push(timer);
  }

  private scheduleRamp(
    t0: number,
    startMs: number,
    endMs: number,
    valuesBeforeRamp: Record<string, number>,
    event: ScoreEvent,
    curve: "linear" | "exp",
    onTick: (params: Record<string, number>) => void
  ): void {
    const startValues: Record<string, number> = {};
    const targetParams = event.params;
    for (const name of Object.keys(targetParams)) {
      startValues[name] = valuesBeforeRamp[name];
    }

    const duration = endMs - startMs;
    for (let tickMs = startMs + RAMP_TICK_MS; tickMs < endMs; tickMs += RAMP_TICK_MS) {
      const progress = (tickMs - startMs) / duration;
      const tickParams = interpolateParams(startValues, targetParams, progress, curve);
      this.scheduleAt(tickMs, t0, () => onTick(tickParams));
    }

    this.scheduleAt(endMs, t0, () => onTick(targetParams));
  }
}

function interpolateParams(
  start: Record<string, number>,
  end: Record<string, number>,
  progress: number,
  curve: "linear" | "exp"
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(end)) {
    out[name] = interpolateValue(start[name], end[name], progress, curve);
  }
  return out;
}

function interpolateValue(
  start: number,
  end: number,
  progress: number,
  curve: "linear" | "exp"
): number {
  if (curve === "linear") {
    return start + (end - start) * progress;
  }

  /*
   * Exponential interpolation matches SuperCollider's `\exp` envelope:
   * value(t) = start * (end/start)^t. Required for musically natural
   * pitch glides and amp fades. Undefined when either endpoint is
   * zero or the endpoints straddle zero -- fall back to linear there
   * rather than emitting NaN/Infinity into OSC.
   */
  if (start === 0 || end === 0 || Math.sign(start) !== Math.sign(end)) {
    return start + (end - start) * progress;
  }
  return start * Math.pow(end / start, progress);
}
