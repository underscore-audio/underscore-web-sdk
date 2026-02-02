/**
 * Automation Runner for Underscore SDK
 *
 * Executes automation plans by interpolating keyframes and
 * sending parameter updates to the synth over time.
 */

import type { Synth } from "./synth.js";
import type {
  AutomationPlan,
  AutomationKeyframe,
  ParamMetadata,
} from "./types.js";

/**
 * Clamp a value between min and max.
 */
export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Interpolate a value at time t given a list of keyframes.
 * Supports linear interpolation and hold (step) curves.
 */
export function valueAtTime(
  keyframes: AutomationKeyframe[],
  t: number,
): number {
  if (keyframes.length === 0) return 0;
  if (t <= keyframes[0].t) return keyframes[0].value;

  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (t >= a.t && t <= b.t) {
      // At an exact keyframe boundary, snap to the later value
      if (t === b.t) return b.value;
      if (a.curve === "hold") return a.value;
      const span = b.t - a.t;
      if (span <= 0) return b.value;
      const u = (t - a.t) / span;
      return a.value + (b.value - a.value) * u;
    }
  }

  return keyframes[keyframes.length - 1].value;
}

export interface AutomationRunnerOptions {
  /**
   * Callback when parameter values are applied.
   * Useful for updating UI to reflect automation changes.
   */
  onAppliedValues?: (
    values: Record<string, number>,
    elapsedSec: number,
  ) => void;

  /**
   * Callback when automation completes (reaches end of duration).
   */
  onComplete?: () => void;

  /**
   * Update interval in milliseconds. Lower = smoother but more CPU.
   * Default: 50ms (20 updates/sec)
   */
  updateIntervalMs?: number;
}

/**
 * Runs an automation plan on a synth, interpolating parameter
 * values over time according to the plan's keyframes.
 *
 * @example
 * \`\`\`typescript
 * const synth = await client.loadSynth(compId, 'my_pad');
 * await synth.play();
 *
 * if (synth.automation) {
 *   const runner = new AutomationRunner();
 *   runner.start(synth);
 *
 *   // Later, to stop:
 *   runner.stop();
 * }
 * \`\`\`
 */
export class AutomationRunner {
  private options: AutomationRunnerOptions;
  private rafId: number | null = null;
  private startMs = 0;
  private lastSendMs = 0;
  private running = false;
  private synth: Synth | null = null;
  private plan: AutomationPlan | null = null;
  private paramsByName: Map<string, ParamMetadata> = new Map();
  private lastValues: Record<string, number> = {};

  constructor(options: AutomationRunnerOptions = {}) {
    this.options = options;
  }

  /**
   * Whether automation is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get elapsed time in seconds since automation started.
   */
  getElapsedSec(): number {
    if (!this.running || !this.startMs) return 0;
    return (performance.now() - this.startMs) / 1000;
  }

  /**
   * Get remaining time in seconds until automation completes.
   */
  getRemainingTime(): number {
    if (!this.plan) return 0;
    return Math.max(0, this.plan.durationSec - this.getElapsedSec());
  }

  /**
   * Get the current automation plan.
   */
  getPlan(): AutomationPlan | null {
    return this.plan;
  }

  /**
   * Start running automation on a synth.
   *
   * @param synth - The synth to automate (must have an automation plan)
   * @param startAtSec - Optional time offset to start from (default: 0)
   */
  start(synth: Synth, startAtSec = 0): void {
    if (!synth.automation) {
      console.warn("[automation] Synth has no automation plan");
      return;
    }

    this.stop();
    this.synth = synth;
    this.plan = synth.automation;
    this.paramsByName = new Map(synth.params.map((p) => [p.name, p]));
    this.lastValues = {};
    this.startMs = performance.now() - startAtSec * 1000;
    this.lastSendMs = 0;
    this.running = true;
    this.tick();
  }

  /**
   * Stop the automation runner.
   */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.running = false;
    this.synth = null;
    this.plan = null;
    this.lastValues = {};
  }

  /**
   * Seek to a specific time in the automation.
   * Only works while running.
   */
  seek(timeSec: number): void {
    if (!this.running || !this.plan) return;
    this.startMs = performance.now() - timeSec * 1000;
    this.lastSendMs = 0; // Force immediate update
    this.lastValues = {}; // Clear cached values to force all params to update
  }

  private tick = (): void => {
    if (!this.running || !this.plan || !this.synth) return;

    // Stop if synth is no longer playing
    if (!this.synth.isPlaying()) {
      this.stop();
      return;
    }

    const now = performance.now();
    const elapsedSec = (now - this.startMs) / 1000;
    const updateInterval = this.options.updateIntervalMs ?? 50;

    // Throttle updates
    if (now - this.lastSendMs >= updateInterval) {
      const values: Record<string, number> = {};

      for (const lane of this.plan.lanes) {
        const meta = this.paramsByName.get(lane.param);
        if (!meta) continue;

        const raw = valueAtTime(lane.keyframes, elapsedSec);
        const v = clamp(raw, meta.min, meta.max);

        // Only send changes (reduce OSC traffic)
        if (this.lastValues[lane.param] !== v) {
          values[lane.param] = v;
          this.lastValues[lane.param] = v;
        }
      }

      if (Object.keys(values).length > 0) {
        this.synth.setParams(values);
        this.options.onAppliedValues?.(values, elapsedSec);
      }
      this.lastSendMs = now;
    }

    // Check if we've reached the end
    if (elapsedSec >= this.plan.durationSec) {
      this.running = false;
      this.options.onComplete?.();
      return;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}
