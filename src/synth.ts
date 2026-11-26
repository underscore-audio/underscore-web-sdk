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

/*
 * Build the {name -> default} map for a synth's params. Used both
 * by `resetParams()` and by score playback as the starting state
 * for any param that may be ramped before it appears in an event.
 */
function defaultParamValues(params: ParamMetadata[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) {
    out[p.name] = p.default;
  }
  return out;
}

export interface SynthPlaybackDriver {
  play(): Promise<void>;
  stop(): void;
  setParams(params: Record<string, number>): void;
  getAllParams(): Record<string, number>;
  isPlaying(): boolean;
  subscribe(listener: SynthStateListener): () => void;
  crossfadeIn(durationSec: number): Promise<void>;
  isCrossfading(): boolean;
}

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
    score?: SynthScore,
    private driver?: SynthPlaybackDriver
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
   * Whether resources have been prepared for playback. Activation uploads them to the engine.
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

    if (this.driver) return this.driver.play();
    this.scheduler.cancel();
    await this.engine.play(this._synthName);

    if (this._score && this._score.events.length > 0) {
      this.scheduler.start({
        score: this._score,
        initialValues: defaultParamValues(this._params),
        onTick: (params) => this.engine.setParams(params),
      });
    }
  }

  /**
   * Stop the synth and cancel any in-flight score events.
   */
  stop(): void {
    if (this.driver) return this.driver.stop();
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
    if (this.driver) this.driver.setParams({ [name]: clampedValue });
    else this.engine.setParam(name, clampedValue);
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
      if (this.driver) this.driver.setParams(validParams);
      else this.engine.setParams(validParams);
    }
  }

  /**
   * Get the current value of a parameter.
   */
  getParam(name: string): number | undefined {
    return this.driver ? this.driver.getAllParams()[name] : this.engine.getParam(name);
  }

  /**
   * Get all current parameter values.
   */
  getAllParams(): Record<string, number> {
    return this.driver ? this.driver.getAllParams() : this.engine.getAllParams();
  }

  /**
   * Reset all parameters to their default values.
   */
  resetParams(): void {
    this.setParams(defaultParamValues(this._params));
  }

  /**
   * Check if the synth is currently playing.
   */
  isPlaying(): boolean {
    return this.driver ? this.driver.isPlaying() : this.engine.isPlaying();
  }

  /**
   * Subscribe to state changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: SynthStateListener): () => void {
    return this.driver ? this.driver.subscribe(listener) : this.engine.subscribe(listener);
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

    if (this.driver) return this.driver.crossfadeIn(durationSec);
    const ampParam = this._params.find((p) => p.name === "amp");
    const targetAmp = ampParam?.default ?? 0.3;

    await this.engine.crossfadeTo(this._synthName, durationSec, targetAmp);
  }

  /**
   * Check if a crossfade is currently in progress.
   */
  isCrossfading(): boolean {
    return this.driver ? this.driver.isCrossfading() : this.engine.isCrossfading();
  }
}
