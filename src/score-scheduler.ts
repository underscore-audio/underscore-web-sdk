/**
 * Score scheduler used by `Synth.play()` / `Synth.stop()`.
 *
 * Walks `SynthScore.events` on start, fires their `params` payloads
 * via the caller-provided `onTick` callback at the matching `tMs`
 * offsets, and cancels any pending fires on `cancel()`.
 *
 * Scheduling uses `setTimeout` against `performance.now()`. Score
 * events are coarse (50ms+ practical resolution -- knob automation,
 * filter sweeps, fades), well above the main-thread queue jitter.
 * If a future feature needs sample-accurate gestures, that change
 * lives behind this same interface.
 */

import type { SynthScore } from "./types.js";

export interface ScoreSchedulerOptions {
  score: SynthScore;
  onTick: (params: Record<string, number>) => void;
}

export class ScoreScheduler {
  private timers: ReturnType<typeof setTimeout>[] = [];

  start(opts: ScoreSchedulerOptions): void {
    this.cancel();
    const t0 = performance.now();
    for (const event of opts.score.events) {
      const delayMs = Math.max(0, event.tMs - (performance.now() - t0));
      const timer = setTimeout(() => opts.onTick(event.params), delayMs);
      this.timers.push(timer);
    }
  }

  cancel(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
