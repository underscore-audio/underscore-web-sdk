import type { SynthScore } from "./types.js";
import type { SuperSonic, OscBundleEncoder } from "supersonic-scsynth";
import { BundlePump } from "./bundle-pump.js";

// Reconstructed absolute-clock positions can differ by floating-point rounding.
const TIMESTAMP_EPSILON = 1e-9;

export interface ScoreSchedulerOptions {
  score: SynthScore;
  onTick: (params: Record<string, number>) => void;
  initialValues: Record<string, number>;
}
export interface LoweredScoreEvent {
  timeSec: number;
  params: Record<string, number>;
}

/** The same discrete timeline drives both audio-thread bundles and parameter snapshots. */
export function lowerScore(
  score: SynthScore,
  initialValues: Record<string, number>
): LoweredScoreEvent[] {
  const result: LoweredScoreEvent[] = [];
  const values = { ...initialValues };
  let previousMs = 0;
  for (const event of score.events) {
    const endMs = Math.max(0, event.tMs);
    const curve = event.curve ?? "step";
    if (curve !== "step" && endMs > previousMs) {
      for (let ms = previousMs + 30; ms < endMs; ms += 30) {
        const progress = (ms - previousMs) / (endMs - previousMs);
        const params: Record<string, number> = {};
        for (const [name, end] of Object.entries(event.params)) {
          const start = values[name];
          // Older scores can automate destinations without published defaults.
          // Their first authored event initializes that lane; do not invent a ramp seed.
          if (start === undefined) continue;
          params[name] =
            curve === "exp" && start !== 0 && end !== 0 && Math.sign(start) === Math.sign(end)
              ? start * Math.pow(end / start, progress)
              : start + (end - start) * progress;
        }
        if (Object.keys(params).length) result.push({ timeSec: ms / 1000, params });
      }
    }
    result.push({ timeSec: endMs / 1000, params: { ...event.params } });
    Object.assign(values, event.params);
    previousMs = endMs;
  }
  return result.sort((a, b) => a.timeSec - b.timeSec);
}

export function scoreValuesAt(
  events: readonly LoweredScoreEvent[],
  defaults: Record<string, number>,
  seconds: number
): Record<string, number> {
  const values = { ...defaults };
  for (const event of events) {
    if (event.timeSec > seconds + TIMESTAMP_EPSILON) break;
    Object.assign(values, event.params);
  }
  return values;
}

export interface AudioScoreOptions extends ScoreSchedulerOptions {
  engine: SuperSonic;
  encoder: OscBundleEncoder;
  nodeId: number;
  startSec?: number;
  onEnd?: () => void;
}

/** One score lowering policy, with an audio-clock transport and a timer-only adapter. */
export class ScoreScheduler {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pump = new BundlePump();
  private audio: AudioScoreOptions | null = null;
  private anchor = 0;
  private timeline: LoweredScoreEvent[] = [];
  private cursor = 0;

  start(opts: ScoreSchedulerOptions): void {
    this.cancel();
    const t0 = performance.now();
    for (const event of lowerScore(opts.score, opts.initialValues)) {
      const delay = Math.max(0, event.timeSec * 1000 - (performance.now() - t0));
      this.timers.push(setTimeout(() => opts.onTick(event.params), delay));
    }
  }

  startAudio(opts: AudioScoreOptions): void {
    this.cancel();
    this.audio = opts;
    this.timeline = lowerScore(opts.score, opts.initialValues);
    const start = Math.max(0, Math.min(opts.startSec ?? 0, opts.score.totalDurationSec));
    this.anchor = opts.engine.superClock.now() + 0.05 - start;
    this.cursor = this.timeline.findIndex((event) => event.timeSec > start + TIMESTAMP_EPSILON);
    if (this.cursor < 0) this.cursor = this.timeline.length;
    this.pump.start({
      engine: opts.engine,
      encoder: opts.encoder,
      t0: this.anchor,
      groups: this.timeline
        .filter((event) => event.timeSec > start + TIMESTAMP_EPSILON)
        .map((event) => ({
          timeSec: event.timeSec,
          packets: [["/n_set", opts.nodeId, ...Object.entries(event.params).flat()]],
        })),
    });
    const tick = (): void => {
      if (this.audio !== opts) return;
      const seconds = this.positionSec;
      const changed: Record<string, number> = {};
      while (
        this.cursor < this.timeline.length &&
        this.timeline[this.cursor].timeSec <= seconds + TIMESTAMP_EPSILON
      ) {
        Object.assign(changed, this.timeline[this.cursor++].params);
      }
      if (Object.keys(changed).length) opts.onTick(changed);
      if (seconds >= opts.score.totalDurationSec) {
        this.cancel();
        opts.onEnd?.();
      } else {
        this.timers = [setTimeout(tick, 30)];
      }
    };
    this.timers.push(setTimeout(tick, 30));
  }

  get isActive(): boolean {
    return this.audio !== null;
  }

  get positionSec(): number {
    return this.audio
      ? Math.max(
          0,
          Math.min(
            this.audio.engine.superClock.now() - this.anchor,
            this.audio.score.totalDurationSec
          )
        )
      : 0;
  }

  get values(): Record<string, number> {
    return this.audio
      ? scoreValuesAt(this.timeline, this.audio.initialValues, this.positionSec)
      : {};
  }

  cancel(): void {
    this.pump.stop();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.audio = null;
  }
}
