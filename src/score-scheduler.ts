/**
 * Score and automation scheduler for the SDK.
 *
 * For ensemble bundles, the API ships a `Score` (a JSON event list:
 * play / set / release per voice at a wall-clock offset) alongside
 * the per-voice SynthDef binaries. The scheduler walks that list and
 * issues `/s_new`, `/n_set`, and `/n_free` against the audio engine
 * at each event's `atSec` offset. For single-voice synths it walks
 * an `AutomationTimeline` against one fixed node.
 *
 * Scheduling tradeoff: events are dispatched via `setTimeout`, not via
 * OSC time-tag bundles. The Supersonic engine the SDK ships against
 * does not expose a time-tag bundle API at the SDK layer, so an OSC
 * time-tag implementation would require a custom worklet shim
 * (significant additional surface). Slow ambient ramps (5-30s) and
 * coarse score events (entrance / release on the order of seconds)
 * sit well above the perceptual jitter floor that setTimeout
 * actually misses on a healthy main thread, so the simpler approach
 * is fine for the current use case. If sample-accurate scheduling
 * becomes a requirement (sub-100ms grooves, polyrhythmic ensembles),
 * revisit with an OSC bundle implementation.
 *
 * Polyphony policy mirrors the API's score contract: each voice has
 * one live instance at a time. A `play` event for an already-live
 * voice frees the prior instance before /s_new'ing the new one.
 */

import type { AudioEngine } from "./audio.js";
import type { ParamMetadata, Score, ScoreEvent, VoiceDef, AutomationTimeline } from "./types.js";

/*
 * Ramp step rate. 30 Hz is well above the JND for slow parameter
 * motion in ambient scores (typical ramp 5-30s, target deltas span
 * seconds of musical motion); the listener cannot perceive 33ms
 * stair-stepping in a 10-second filter sweep. Higher rates would
 * burn timer cycles for no audible gain.
 */
const RAMP_STEP_HZ = 30;

/**
 * One live voice instance: the engine node id and a cache of the
 * most recently set value per param. The cache lets ramps interpolate
 * from the actual previous-set value rather than the param default,
 * which matters when the score chains multiple SETs on the same param.
 */
interface LiveVoice {
  nodeId: number;
  paramValues: Map<string, number>;
}

export class ScoreScheduler {
  private engine: AudioEngine;
  private voices: VoiceDef[];
  private liveVoices: Map<string, LiveVoice> = new Map();
  private timers: Set<ReturnType<typeof setTimeout>> = new Set();

  constructor(engine: AudioEngine, voices: VoiceDef[]) {
    this.engine = engine;
    this.voices = voices;
  }

  /**
   * Schedule every event in the score against the engine. Returns the
   * number of events actually scheduled (== `score.events.length`
   * after voice-name filtering, since voice-name filtering happens at
   * dispatch time rather than schedule time).
   */
  scheduleScore(score: Score): number {
    let scheduled = 0;
    for (const event of score.events) {
      const delayMs = Math.max(0, event.atSec * 1000);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.dispatchScoreEvent(event);
      }, delayMs);
      this.timers.add(timer);
      scheduled += 1;
    }
    return scheduled;
  }

  /**
   * Schedule a single-voice automation timeline against a fixed
   * already-live node. Mirrors the per-voice setParam behavior for the
   * single-synth case: each automation event becomes a /n_set on the
   * one live node, optionally ramped.
   */
  scheduleAutomation(
    automation: AutomationTimeline,
    nodeId: number,
    params: ParamMetadata[]
  ): number {
    const paramByName = new Map(params.map((p) => [p.name, p]));
    /*
     * The single-voice case keeps its own param cache scoped to this
     * node so ramp starts pick up the most recent /n_set value
     * (matching the bundle path's per-voice cache).
     */
    const cache = new Map<string, number>();
    for (const p of params) {
      cache.set(p.name, p.default);
    }

    let scheduled = 0;
    for (const event of automation.events) {
      const delayMs = Math.max(0, event.atSec * 1000);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        const meta = paramByName.get(event.param);
        if (!meta) return;
        const target = clamp(event.value, meta.min, meta.max);
        const rampSec = event.rampSec ?? 0;
        if (rampSec <= 0) {
          this.engine.setParamOnNode(nodeId, event.param, target);
          cache.set(event.param, target);
        } else {
          const fromValue = cache.get(event.param) ?? meta.default;
          this.rampOnNode(nodeId, event.param, fromValue, target, rampSec);
          cache.set(event.param, target);
        }
      }, delayMs);
      this.timers.add(timer);
      scheduled += 1;
    }
    return scheduled;
  }

  /**
   * Free every live voice and cancel every scheduled (and in-flight
   * ramp) timer. Called from `Synth.stop()` for bundles.
   */
  cancelAll(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const live of this.liveVoices.values()) {
      this.engine.freeNode(live.nodeId);
    }
    this.liveVoices.clear();
  }

  /**
   * Fan a parameter set out to every live voice that declares the
   * param. Returns the count of voices that were updated. Used by
   * `Synth.setParam` for bundles.
   */
  forwardParamToLiveVoices(name: string, value: number): number {
    let updated = 0;
    for (const voice of this.voices) {
      const meta = voice.params.find((p) => p.name === name);
      if (!meta) continue;
      const live = this.liveVoices.get(voice.name);
      if (!live) continue;
      const clamped = clamp(value, meta.min, meta.max);
      this.engine.setParamOnNode(live.nodeId, name, clamped);
      live.paramValues.set(name, clamped);
      updated += 1;
    }
    return updated;
  }

  /**
   * True iff at least one voice declares the given param. Used by
   * `Synth.setParam` to suppress the "Unknown parameter" warning when
   * a name is recognized by some voices but happens to have no live
   * matches at the moment.
   */
  hasParam(name: string): boolean {
    return this.voices.some((v) => v.params.some((p) => p.name === name));
  }

  /**
   * Snapshot of currently-live voice node IDs (voice name -> node id).
   * Used by `Synth.crossfadeIn` so it can ramp `amp` on each live
   * voice in lockstep without re-reading internal state.
   */
  getLiveVoiceNodes(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [name, live] of this.liveVoices.entries()) {
      out.set(name, live.nodeId);
    }
    return out;
  }

  /**
   * For a given voice name, return the metadata of the param matching
   * `name`, or undefined. Convenience for `Synth.crossfadeIn` to
   * resolve the per-voice amp range/default when ramping.
   */
  getVoiceParam(voiceName: string, paramName: string): ParamMetadata | undefined {
    const voice = this.voices.find((v) => v.name === voiceName);
    if (!voice) return undefined;
    return voice.params.find((p) => p.name === paramName);
  }

  private dispatchScoreEvent(event: ScoreEvent): void {
    const voice = this.voices.find((v) => v.name === event.voice);
    if (!voice) return;

    if (event.action === "play") {
      this.dispatchPlay(voice, event);
      return;
    }

    if (event.action === "set") {
      this.dispatchSet(voice, event);
      return;
    }

    if (event.action === "release") {
      this.dispatchRelease(voice, event);
      return;
    }
  }

  private dispatchPlay(voice: VoiceDef, event: ScoreEvent): void {
    /*
     * Per-voice polyphony: a `play` for an already-live voice replaces
     * the prior instance. Free first so the OSC node id space stays
     * tidy and the listener doesn't briefly hear two stacked instances
     * of the same voice when the score restages.
     */
    const prior = this.liveVoices.get(voice.name);
    if (prior) {
      this.engine.freeNode(prior.nodeId);
    }

    const initial = clampParams(event.params ?? {}, voice.params);
    /*
     * spawnInstance is async only because it may need to resume the
     * AudioContext; in practice the context is already running by the
     * time the score fires. Floating the promise is safe because the
     * /s_new is dispatched synchronously inside spawnInstance after
     * the resume; we only need the awaited node id to track the
     * live-voice mapping.
     */
    void this.engine.spawnInstance(voice.name, initial).then((nodeId) => {
      const cache = new Map<string, number>();
      for (const p of voice.params) {
        cache.set(p.name, p.default);
      }
      for (const [k, v] of Object.entries(initial)) {
        cache.set(k, v);
      }
      this.liveVoices.set(voice.name, { nodeId, paramValues: cache });
    });
  }

  private dispatchSet(voice: VoiceDef, event: ScoreEvent): void {
    const live = this.liveVoices.get(voice.name);
    if (!live) return;
    if (!event.params) return;
    const clamped = clampParams(event.params, voice.params);
    const rampSec = event.rampSec ?? 0;
    if (rampSec <= 0) {
      for (const [name, value] of Object.entries(clamped)) {
        this.engine.setParamOnNode(live.nodeId, name, value);
        live.paramValues.set(name, value);
      }
      return;
    }
    for (const [name, value] of Object.entries(clamped)) {
      const fromValue = live.paramValues.get(name);
      const start = fromValue ?? voice.params.find((p) => p.name === name)?.default ?? value;
      this.rampOnNode(live.nodeId, name, start, value, rampSec);
      live.paramValues.set(name, value);
    }
  }

  private dispatchRelease(voice: VoiceDef, event: ScoreEvent): void {
    const live = this.liveVoices.get(voice.name);
    if (!live) return;
    /*
     * Per the score-types contract: `release` lowers gate to 0 if the
     * voice exposes a `gate` param, otherwise frees the node directly.
     * Voices with EnvGen-and-doneAction:0 envelopes don't expose gate
     * and need an explicit /n_free.
     */
    const hasGate = voice.params.some((p) => p.name === "gate");
    const rampSec = event.rampSec ?? 0;
    if (hasGate) {
      this.engine.setParamOnNode(live.nodeId, "gate", 0);
      /*
       * After a gate=0 we still need to /n_free the node once the
       * release tail has elapsed; SuperCollider's standard EnvGen
       * doesn't auto-free with doneAction:0 (the SynthDef contract
       * we generate uses doneAction:0 specifically so the score is
       * in charge of voice lifetimes). Schedule a free at rampSec
       * (defaulting to a generous 4s tail).
       */
      const tailMs = (rampSec > 0 ? rampSec : 4) * 1000;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.engine.freeNode(live.nodeId);
      }, tailMs);
      this.timers.add(timer);
    } else {
      this.engine.freeNode(live.nodeId);
    }
    this.liveVoices.delete(voice.name);
  }

  private rampOnNode(
    nodeId: number,
    paramName: string,
    fromValue: number,
    toValue: number,
    durationSec: number
  ): void {
    const stepCount = Math.max(1, Math.floor(durationSec * RAMP_STEP_HZ));
    const stepMs = (durationSec * 1000) / stepCount;
    for (let i = 1; i <= stepCount; i++) {
      const ratio = i / stepCount;
      const value = fromValue + (toValue - fromValue) * ratio;
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.engine.setParamOnNode(nodeId, paramName, value);
      }, i * stepMs);
      this.timers.add(timer);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampParams(
  raw: Record<string, number>,
  declared: ParamMetadata[]
): Record<string, number> {
  const byName = new Map(declared.map((p) => [p.name, p]));
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw)) {
    const meta = byName.get(name);
    if (!meta) continue;
    out[name] = clamp(value, meta.min, meta.max);
  }
  return out;
}
