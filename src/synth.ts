/**
 * Synth class - represents a loaded, playable synthesizer.
 *
 * Created by Underscore.loadSynth() or from generation results.
 * Provides methods for playback and parameter control.
 *
 * If the synth has an automation plan, it will automatically run
 * when play() is called and stop when stop() is called.
 */

import type { AudioEngine } from "./audio.js";
import type { ParamMetadata, AutomationPlan, SynthStateListener, SampleMetadata } from "./types.js";
import { AutomationRunner, type AutomationRunnerOptions } from "./automation.js";
import { SynthError } from "./errors.js";

export interface PlayOptions {
  /**
   * Whether to run automation automatically. Default: true
   */
  automate?: boolean;

  /**
   * Time offset to start automation from (in seconds). Default: 0
   */
  automationStartAt?: number;
}

export class Synth {
  private engine: AudioEngine;
  private _compositionId: string;
  private _synthName: string;
  private _description: string;
  private _params: ParamMetadata[];
  private _automation?: AutomationPlan;
  private _samples?: SampleMetadata[];
  private _loaded: boolean = false;
  private _automationRunner: AutomationRunner | null = null;
  private _automationOptions: AutomationRunnerOptions = {};

  constructor(
    engine: AudioEngine,
    compositionId: string,
    synthName: string,
    description: string,
    params: ParamMetadata[],
    automation?: AutomationPlan,
    samples?: SampleMetadata[]
  ) {
    this.engine = engine;
    this._compositionId = compositionId;
    this._synthName = synthName;
    this._description = description;
    this._params = params;
    this._automation = automation;
    this._samples = samples;
  }

  /**
   * Composition ID this synth belongs to.
   */
  get compositionId(): string {
    return this._compositionId;
  }

  /**
   * Synth name (used for playback).
   */
  get name(): string {
    return this._synthName;
  }

  /**
   * Human-readable description of the synth.
   */
  get description(): string {
    return this._description;
  }

  /**
   * Parameter metadata for UI controls.
   */
  get params(): ParamMetadata[] {
    return this._params;
  }

  /**
   * Optional automation plan.
   */
  get automation(): AutomationPlan | undefined {
    return this._automation;
  }

  /**
   * Optional audio samples used by this synth.
   */
  get samples(): SampleMetadata[] | undefined {
    return this._samples;
  }

  /**
   * Whether the synth has audio samples.
   */
  get hasSamples(): boolean {
    return !!(this._samples && this._samples.length > 0);
  }

  /**
   * Whether this synth has an automation plan.
   */
  get hasAutomation(): boolean {
    return !!(this._automation && this._automation.lanes && this._automation.lanes.length > 0);
  }

  /**
   * Whether the synthdef has been loaded into the engine.
   */
  get loaded(): boolean {
    return this._loaded;
  }

  /**
   * Mark the synth as loaded (called internally).
   */
  markLoaded(): void {
    this._loaded = true;
  }

  /**
   * Configure automation runner options.
   * Call this before play() to set callbacks for automation events.
   *
   * @example
   * synth.configureAutomation({
   *   onAppliedValues: (values, elapsed) => updateUI(values),
   *   onComplete: () => console.log('Automation finished'),
   * });
   */
  configureAutomation(options: AutomationRunnerOptions): void {
    this._automationOptions = options;
  }

  /**
   * Play the synth.
   * If the synth has automation, it starts automatically (unless disabled).
   * Throws if not loaded.
   *
   * @param options - Optional play settings
   */
  async play(options: PlayOptions = {}): Promise<void> {
    if (!this._loaded) {
      throw new SynthError("Synth not loaded. Call Underscore.loadSynth() first.");
    }

    const { automate = true, automationStartAt = 0 } = options;

    await this.engine.play(this._synthName);

    // Auto-start automation if available and enabled
    if (automate && this.hasAutomation) {
      this._automationRunner = new AutomationRunner(this._automationOptions);
      this._automationRunner.start(this, automationStartAt);
    }
  }

  /**
   * Stop the synth and any running automation.
   */
  stop(): void {
    if (this._automationRunner) {
      this._automationRunner.stop();
      this._automationRunner = null;
    }
    this.engine.stop();
  }

  /**
   * Get the automation runner (if automation is running).
   * Useful for seeking, checking elapsed time, etc.
   */
  getAutomationRunner(): AutomationRunner | null {
    return this._automationRunner;
  }

  /**
   * Whether automation is currently running.
   */
  isAutomationRunning(): boolean {
    return this._automationRunner?.isRunning() ?? false;
  }

  /**
   * Seek to a specific time in the automation.
   * Only works if automation is running.
   */
  seekAutomation(timeSec: number): void {
    this._automationRunner?.seek(timeSec);
  }

  /**
   * Get elapsed automation time in seconds.
   */
  getAutomationElapsed(): number {
    return this._automationRunner?.getElapsedSec() ?? 0;
  }

  /**
   * Get remaining automation time in seconds.
   */
  getAutomationRemaining(): number {
    return this._automationRunner?.getRemainingTime() ?? 0;
  }

  /**
   * Set a parameter value.
   * Note: if automation is running, it may override this value.
   */
  setParam(name: string, value: number): void {
    const param = this._params.find((p) => p.name === name);
    if (!param) {
      console.warn(`Unknown parameter: ${name}`);
      return;
    }

    const clampedValue = Math.max(param.min, Math.min(param.max, value));
    this.engine.setParam(name, clampedValue);
  }

  /**
   * Set multiple parameters at once.
   * Note: if automation is running, it may override these values.
   */
  setParams(params: Record<string, number>): void {
    const validParams: Record<string, number> = {};

    for (const [name, value] of Object.entries(params)) {
      const param = this._params.find((p) => p.name === name);
      if (!param) {
        console.warn(`Unknown parameter: ${name}`);
        continue;
      }

      validParams[name] = Math.max(param.min, Math.min(param.max, value));
    }

    if (Object.keys(validParams).length > 0) {
      this.engine.setParams(validParams);
    }
  }

  /**
   * Get the current value of a parameter.
   */
  getParam(name: string): number | undefined {
    return this.engine.getParam(name);
  }

  /**
   * Get all current parameter values.
   */
  getAllParams(): Record<string, number> {
    return this.engine.getAllParams();
  }

  /**
   * Reset all parameters to their default values.
   */
  resetParams(): void {
    const defaults: Record<string, number> = {};
    for (const param of this._params) {
      defaults[param.name] = param.default;
    }
    this.setParams(defaults);
  }

  /**
   * Check if the synth is currently playing.
   */
  isPlaying(): boolean {
    return this.engine.isPlaying();
  }

  /**
   * Subscribe to state changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: SynthStateListener): () => void {
    return this.engine.subscribe(listener);
  }

  /**
   * Crossfade into this synth from whatever is currently playing.
   * The synth must be loaded first.
   * If the synth has automation, it starts automatically.
   *
   * @param durationSec - Duration of the crossfade in seconds (default: 3)
   * @param options - Optional play settings for automation
   */
  async crossfadeIn(durationSec: number = 3, options: PlayOptions = {}): Promise<void> {
    if (!this._loaded) {
      throw new SynthError("Synth not loaded. Call Underscore.loadSynth() first.");
    }

    const { automate = true, automationStartAt = 0 } = options;

    const ampParam = this._params.find((p) => p.name === "amp");
    const targetAmp = ampParam?.default ?? 0.3;

    await this.engine.crossfadeTo(this._synthName, durationSec, targetAmp);

    // Auto-start automation if available and enabled
    if (automate && this.hasAutomation) {
      this._automationRunner = new AutomationRunner(this._automationOptions);
      this._automationRunner.start(this, automationStartAt);
    }
  }

  /**
   * Check if a crossfade is currently in progress.
   */
  isCrossfading(): boolean {
    return this.engine.isCrossfading();
  }
}
