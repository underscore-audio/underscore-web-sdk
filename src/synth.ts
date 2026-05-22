/**
 * Synth class - represents a loaded, playable synthesizer.
 *
 * Created by Underscore.loadSynth() or from generation results.
 * Provides methods for playback and parameter control.
 *
 * Two shapes are supported behind one class:
 *
 *   1. Single-voice synth: `metadata.voices` is absent. Behaves the
 *      same as before bundles existed -- `play()` instantiates one
 *      SynthDef on the engine, `setParam` addresses that one node,
 *      `startPerformance()` runs an optional `automation` timeline.
 *
 *   2. Ensemble bundle: `metadata.voices` is present with N >= 2
 *      voices and (usually) a `score` describing when each voice
 *      enters / changes / leaves. The Synth class owns a private
 *      `ScoreScheduler` that drives `/s_new` per voice and forwards
 *      `setParam` to every live voice that declares the param.
 *      `play()` for a bundle is a no-op that just resumes the audio
 *      context; the actual voice instantiation happens via
 *      `startPerformance()` (the score's `play` events).
 *
 * Branching on `metadata.voices` internally beats subclassing
 * (BundleSynth) because the public surface is identical and the
 * branch is small and contained. If a third runtime shape lands the
 * abstraction can be revisited.
 */

import type { AudioEngine } from "./audio.js";
import type {
  ParamMetadata,
  SynthStateListener,
  SampleMetadata,
  VoiceDef,
  Score,
  AutomationTimeline,
} from "./types.js";
import { SynthError } from "./errors.js";
import { ScoreScheduler } from "./score-scheduler.js";

export class Synth {
  private engine: AudioEngine;
  private _compositionId: string;
  private _synthName: string;
  private _description: string;
  private _params: ParamMetadata[];
  private _samples?: SampleMetadata[];
  private _voices?: VoiceDef[];
  private _score?: Score;
  private _automation?: AutomationTimeline;
  private _loaded: boolean = false;
  private scheduler: ScoreScheduler | null = null;

  constructor(
    engine: AudioEngine,
    compositionId: string,
    synthName: string,
    description: string,
    params: ParamMetadata[],
    samples?: SampleMetadata[],
    voices?: VoiceDef[],
    score?: Score,
    automation?: AutomationTimeline
  ) {
    this.engine = engine;
    this._compositionId = compositionId;
    this._synthName = synthName;
    this._description = description;
    this._params = params;
    this._samples = samples;
    this._voices = voices && voices.length > 0 ? voices : undefined;
    this._score = score;
    this._automation = automation;
    if (this._voices) {
      this.scheduler = new ScoreScheduler(this.engine, this._voices);
    }
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
   * Whether the synth has audio samples.
   */
  get hasSamples(): boolean {
    return !!(this._samples && this._samples.length > 0);
  }

  /**
   * True when this is an ensemble bundle (>= 2 voices loaded together).
   * UI surfaces can use this to switch between "one waveform / one set
   * of params" affordances and "list of voices" affordances.
   */
  get isBundle(): boolean {
    return !!this._voices;
  }

  /**
   * The bundle's voice manifest, or undefined for single-voice synths.
   */
  get voices(): VoiceDef[] | undefined {
    return this._voices;
  }

  /**
   * The bundle's score, or undefined for single-voice synths or
   * bundles that did not ship a score.
   */
  get score(): Score | undefined {
    return this._score;
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
   * Play the synth.
   * Throws if not loaded.
   *
   * For a single-voice synth, this issues `/s_new` on the engine
   * and starts producing sound immediately.
   *
   * For a bundle, this is a deliberate no-op: the score's `play`
   * events drive `/s_new` per voice at their scheduled times, and
   * issuing `/s_new` on voice[0] here would make voice 1 audible
   * BEFORE the score started, masking the multi-voice composition.
   * Bundle callers should call `play()` (to satisfy the user-gesture
   * contract for `audioContext.resume()`) and then
   * `startPerformance()` (which schedules the score).
   */
  async play(): Promise<void> {
    if (!this._loaded) {
      throw new SynthError("Synth not loaded. Call Underscore.loadSynth() first.");
    }

    if (this._voices) {
      await this.engine.resumeContext();
      return;
    }

    await this.engine.play(this._synthName);
  }

  /**
   * Stop the synth.
   *
   * For a bundle, this frees every live voice node and cancels every
   * pending scheduled timer (score events queued for the future plus
   * any in-flight ramp steps). For a single-voice synth it frees the
   * one live node.
   */
  stop(): void {
    if (this.scheduler) {
      this.scheduler.cancelAll();
    }
    if (!this._voices) {
      this.engine.stop();
    }
  }

  /**
   * Set a parameter value.
   *
   * For a bundle, the value is fanned out to every live voice that
   * declares the param. Voices without the param are skipped; the
   * value is clamped per-voice using each voice's declared min/max.
   * Setting before `startPerformance()` (when no voices are live) is
   * a no-op.
   */
  setParam(name: string, value: number): void {
    if (this._voices && this.scheduler) {
      this.scheduler.forwardParamToLiveVoices(name, value);
      if (!this.scheduler.hasParam(name)) {
        console.warn(`Unknown parameter: ${name}`);
      }
      return;
    }

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
    if (this._voices && this.scheduler) {
      for (const [name, value] of Object.entries(params)) {
        this.scheduler.forwardParamToLiveVoices(name, value);
        if (!this.scheduler.hasParam(name)) {
          console.warn(`Unknown parameter: ${name}`);
        }
      }
      return;
    }

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
   * For a bundle, the canonical entry point is `startPerformance()`;
   * `crossfadeIn` is supported as a convenience that ramps `amp` on
   * every currently-live voice from 0 to its declared default
   * simultaneously. Voices that the score has not yet played are
   * unaffected; they will enter at full amp at their scheduled atSec.
   *
   * Group-level amp control (a single `Group` node with the bundle's
   * voices as children, modulating one master amp) would be cleaner,
   * but Supersonic's SDK surface does not expose Group nodes here;
   * the per-voice ramp is observable enough for the crossfade UX and
   * keeps the audio engine surface small.
   *
   * @param durationSec - Duration of the crossfade in seconds (default: 3)
   */
  async crossfadeIn(durationSec: number = 3): Promise<void> {
    if (!this._loaded) {
      throw new SynthError("Synth not loaded. Call Underscore.loadSynth() first.");
    }

    if (this._voices && this.scheduler) {
      await this.engine.resumeContext();
      const liveNodes = this.scheduler.getLiveVoiceNodes();
      const steps = Math.max(1, Math.floor(durationSec * 30));
      const stepDuration = (durationSec * 1000) / steps;
      const targets = new Map<string, number>();
      for (const [voiceName] of liveNodes.entries()) {
        const ampParam = this.scheduler.getVoiceParam(voiceName, "amp");
        targets.set(voiceName, ampParam?.default ?? 0.3);
      }
      for (let i = 1; i <= steps; i++) {
        await sleep(stepDuration);
        const ratio = i / steps;
        for (const [voiceName, nodeId] of liveNodes.entries()) {
          const target = targets.get(voiceName) ?? 0.3;
          this.engine.setParamOnNode(nodeId, "amp", target * ratio);
        }
      }
      return;
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

  /**
   * Start the per-synth performance timeline.
   *
   * Returns `true` when something was actually scheduled (the bundle's
   * `score`, the bundle's voices played at t=0 if no score exists, or
   * the single-voice `automation` timeline). Returns `false` when the
   * synth has no timeline-like artifact and the caller's only entry
   * point should be `play()` + manual `setParam`.
   *
   * For ensemble bundles this is the canonical entry point: callers
   * should `await synth.play()` (resumes the audio context under a
   * user gesture, no-op `/s_new`) and then `synth.startPerformance()`
   * to actually fire the voices according to the score.
   */
  startPerformance(): boolean {
    if (!this._loaded) return false;

    if (this._voices && this.scheduler) {
      if (this._score && this._score.events.length > 0) {
        this.scheduler.scheduleScore(this._score);
        return true;
      }
      /*
       * Degraded fallback: if the bundle shipped without a score,
       * play every voice at t=0 with defaults so the listener at
       * least hears all voices instead of silence. This is purely
       * rescue behavior; the audit-grade path is for the score
       * generator to succeed.
       */
      this.startBundleFallback();
      return true;
    }

    if (this._automation && this._automation.events.length > 0) {
      this.startSingleVoiceAutomation();
      return true;
    }

    return false;
  }

  private startBundleFallback(): void {
    if (!this._voices || !this.scheduler) return;
    const fallbackScore: Score = {
      durationSec: 180,
      loop: false,
      events: this._voices.map((v) => ({
        atSec: 0,
        voice: v.name,
        action: "play" as const,
      })),
    };
    console.warn(
      `Synth ${this._synthName}: bundle has no score, falling back to play-all-voices-at-t0`
    );
    this.scheduler.scheduleScore(fallbackScore);
  }

  private startSingleVoiceAutomation(): void {
    if (!this._automation) return;
    /*
     * For the single-voice path the audio engine already tracks a
     * single live node id internally. We don't have a public accessor
     * for it, but the scheduler only needs a node id to /n_set against;
     * sharing a fresh ScoreScheduler instance limited to one synthetic
     * voice would re-implement the fan-out for no benefit. Instead,
     * walk the automation timeline directly through engine.setParam,
     * which targets the engine's currently-live node by design.
     */
    const paramByName = new Map(this._params.map((p) => [p.name, p]));
    const cache = new Map<string, number>();
    for (const p of this._params) {
      cache.set(p.name, p.default);
    }
    for (const event of this._automation.events) {
      const delayMs = Math.max(0, event.atSec * 1000);
      setTimeout(() => {
        const meta = paramByName.get(event.param);
        if (!meta) return;
        const target = Math.max(meta.min, Math.min(meta.max, event.value));
        const rampSec = event.rampSec ?? 0;
        if (rampSec <= 0) {
          this.engine.setParam(event.param, target);
          cache.set(event.param, target);
          return;
        }
        const fromValue = cache.get(event.param) ?? meta.default;
        const stepCount = Math.max(1, Math.floor(rampSec * 30));
        const stepMs = (rampSec * 1000) / stepCount;
        for (let i = 1; i <= stepCount; i++) {
          const ratio = i / stepCount;
          const value = fromValue + (target - fromValue) * ratio;
          setTimeout(() => {
            this.engine.setParam(event.param, value);
          }, i * stepMs);
        }
        cache.set(event.param, target);
      }, delayMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
