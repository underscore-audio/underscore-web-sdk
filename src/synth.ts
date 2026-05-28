/**
 * Synth class - represents a loaded, playable synthesizer.
 *
 * Created by Underscore.loadSynth() or from generation results.
 * Provides methods for playback and parameter control.
 */

import type { AudioEngine } from "./audio.js";
import type { ParamMetadata, SynthStateListener, SampleMetadata, SynthScore } from "./types.js";
import { SynthError } from "./errors.js";
import { ScoreScheduler } from "./score-scheduler.js";

export class Synth {
  private engine: AudioEngine;
  private _compositionId: string;
  private _synthName: string;
  private _description: string;
  private _params: ParamMetadata[];
  private _samples?: SampleMetadata[];
  private _score?: SynthScore;
  private _loaded: boolean = false;
  /*
   * The scheduler is owned by the Synth (rather than the AudioEngine)
   * because each Synth instance binds to one score. The engine stays
   * general-purpose; consumers that don't need score playback see
   * exactly the same engine surface as before.
   */
  private scheduler = new ScoreScheduler();

  constructor(
    engine: AudioEngine,
    compositionId: string,
    synthName: string,
    description: string,
    params: ParamMetadata[],
    samples?: SampleMetadata[],
    score?: SynthScore
  ) {
    this.engine = engine;
    this._compositionId = compositionId;
    this._synthName = synthName;
    this._description = description;
    this._params = params;
    this._samples = samples;
    this._score = score;
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
   * Optional audio samples used by this synth.
   */
  get samples(): SampleMetadata[] | undefined {
    return this._samples;
  }

  /**
   * Optional score that performs this synth over time. Walked by
   * the scheduler on `play()`; cancelled on `stop()`.
   */
  get score(): SynthScore | undefined {
    return this._score;
  }

  /**
   * Whether the synth has audio samples.
   */
  get hasSamples(): boolean {
    return !!(this._samples && this._samples.length > 0);
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
   * Play the synth. Throws if not loaded.
   *
   * If this synth has a `score`, the scheduler starts automatically
   * once the synth is up. Each event fires `setParams` on the
   * running node at its `tMs` offset. `stop()` cancels the
   * scheduler along with the synth node.
   */
  async play(): Promise<void> {
    if (!this._loaded) {
      throw new SynthError("Synth not loaded. Call Underscore.loadSynth() first.");
    }

    this.scheduler.cancel();
    await this.engine.play(this._synthName);

    if (this._score && this._score.events.length > 0) {
      /*
       * The scheduler needs starting values for any param that may
       * be ramped before it has appeared in a prior event. Synth
       * defaults are the only sensible source: the engine's
       * "current" map at play-time is the freshly-loaded synth's
       * defaults too, so the two agree.
       */
      const initialValues: Record<string, number> = {};
      for (const p of this._params) {
        initialValues[p.name] = p.default;
      }

      this.scheduler.start({
        score: this._score,
        initialValues,
        onTick: (params) => this.engine.setParams(params),
      });
    }
  }

  /**
   * Stop the synth and cancel any in-flight score events.
   */
  stop(): void {
    this.scheduler.cancel();
    this.engine.stop();
  }

  /**
   * Set a parameter value.
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
   *
   * @param durationSec - Duration of the crossfade in seconds (default: 3)
   */
  async crossfadeIn(durationSec: number = 3): Promise<void> {
    if (!this._loaded) {
      throw new SynthError("Synth not loaded. Call Underscore.loadSynth() first.");
    }

    const ampParam = this._params.find((p) => p.name === "amp");
    const targetAmp = ampParam?.default ?? 0.3;

    await this.engine.crossfadeTo(this._synthName, durationSec, targetAmp);
  }

  /**
   * Check if a crossfade is currently in progress.
   */
  isCrossfading(): boolean {
    return this.engine.isCrossfading();
  }
}
