/**
 * Audio engine wrapping Supersonic (scsynth WASM).
 *
 * This module manages the WebAssembly-based SuperCollider audio engine,
 * handling initialization, synthdef loading, sample loading, playback, and parameter control.
 */

import type { SynthState, SynthStateListener, SampleMetadata } from "./types.js";
import type { SuperSonic, OscBundleEncoder } from "supersonic-scsynth";
import { type Logger, noopLogger } from "./debug.js";
import { AudioError } from "./errors.js";
import {
  MASTER_VOLUME_DEFAULT,
  MASTER_VOLUME_SMOOTHING_SEC,
  clampMasterVolume,
  spliceMasterGain,
} from "./audio/master-volume.js";
import { resumeAudioContext } from "./audio/resume.js";
import { INIT_TIMEOUT_MS, RESOURCE_TIMEOUT_MS, createInitTimeout } from "./audio/init-watchdog.js";

export interface AudioEngineConfig {
  wasmBaseUrl: string;
  workerBaseUrl?: string;
  logger?: Logger;
  /**
   * Override the engine init watchdog (milliseconds).
   *
   * Production code should leave this unset; it exists so tests can
   * exercise timeout paths without waiting for production deadlines.
   * Not surfaced through the public `Underscore` client to keep that
   * contract narrow.
   *
   * @internal
   */
  initTimeoutMs?: number;
}

export class AudioEngine {
  private sonic: SuperSonic | null = null;
  private osc: OscBundleEncoder | null = null;
  private currentNodeId = 1000;
  private currentSynthName: string | null = null;
  /*
   * One engine, one audible owner. Program playback (program.ts) shares
   * this engine with the single-synth surface, and whichever side starts
   * must silence the other first. The engine cannot know about the
   * program transport (that would invert the layering), so the
   * Underscore client wires this callback at construction; it fires
   * before any single-synth voice starts. Null in engine-only usage.
   *
   * @internal
   */
  onBeforePlayback: (() => void) | null = null;
  private _isPlaying = false;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private initAttempt: symbol | null = null;
  private initializingContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private listeners: Set<SynthStateListener> = new Set();
  private paramValues: Map<string, number> = new Map();
  private config: AudioEngineConfig;
  private loadedBuffers: Set<number> = new Set();
  private crossfadeInProgress = false;
  private outgoingNodeId: number | null = null;
  private log: Logger;
  private masterGain: GainNode | null = null;
  private playbackGain: GainNode | null = null;
  private masterVolume: number = MASTER_VOLUME_DEFAULT;

  constructor(config: AudioEngineConfig) {
    this.config = config;
    this.log = config.logger ?? noopLogger;
  }

  get state(): SynthState {
    return {
      playing: this._isPlaying,
      synthName: this.currentSynthName,
      paramValues: Object.fromEntries(this.paramValues),
    };
  }

  /**
   * Subscribe to state changes.
   * Returns an unsubscribe function.
   */
  subscribe(listener: SynthStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state = this.state;
    this.listeners.forEach((l) => l(state));
  }

  /**
   * Initialize the audio engine.
   * Must be called from a user interaction (click/tap) due to browser autoplay policies.
   *
   * Resource delivery is bounded separately from the engine boot deadline
   * ({@link INIT_TIMEOUT_MS}). A stalled phase rejects with an
   * {@link AudioError} that explains the gesture requirement. The internal
   * init state is cleared on rejection so a retry from inside a real
   * gesture handler starts fresh; without this clear, an early pre-gesture
   * call would poison every subsequent attempt with the same hung promise.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    const session =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = "playback";
      } catch {
        this.log.debug("Audio-session playback hint unavailable");
      }
    }
    // Create and resume before imports or resource delivery consume the gesture.
    const context =
      typeof AudioContext === "undefined"
        ? null
        : new AudioContext({ latencyHint: "playback", sampleRate: 48000 });
    this.initializingContext = context;
    const unlocked = resumeAudioContext(context);
    const attempt = Symbol("audio initialization");
    this.initAttempt = attempt;
    this.initPromise = this.initWithWatchdog(attempt, context, unlocked).catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async initWithWatchdog(
    attempt: symbol,
    context: AudioContext | null,
    unlocked: Promise<void>
  ): Promise<void> {
    const deadline = createInitTimeout(this.config.initTimeoutMs ?? RESOURCE_TIMEOUT_MS);
    try {
      await Promise.race([
        Promise.all([
          unlocked,
          this.doInit(attempt, context, () =>
            deadline.restart(this.config.initTimeoutMs ?? INIT_TIMEOUT_MS)
          ),
        ]),
        deadline.timeoutPromise,
      ]);
      this.initialized = true;
      this.notify();
    } catch (err) {
      this.initAttempt = null;
      const sonic = this.sonic;
      this.sonic = null;
      this.initialized = false;
      // A stalled browser audio thread can also stall shutdown/close. Detach
      // this attempt immediately so cleanup cannot block failure or a retry.
      try {
        void sonic?.shutdown().catch(() => {});
      } catch {
        // Close our context even if a partially initialized engine cannot shut down.
      }
      if (context && context.state !== "closed") {
        try {
          void context.close().catch(() => {});
        } catch {
          // A browser may have already released the failed context.
        }
      }
      throw err;
    } finally {
      deadline.cancel();
      if (this.initAttempt === attempt) this.initAttempt = null;
      if (this.initializingContext === context) this.initializingContext = null;
    }
  }

  private async doInit(
    attempt: symbol,
    context: AudioContext | null,
    resourcesReady: () => void
  ): Promise<void> {
    const { SuperSonic } = await import("supersonic-scsynth");
    if (this.initAttempt !== attempt) return;

    const workerBaseUrl = this.config.workerBaseUrl || `${this.config.wasmBaseUrl}workers/`;

    /*
     * Hold the freshly-constructed instance in a local. After the
     * `await sonic.init()` below, the watchdog timeout may have
     * already won the race and detached `this.sonic` (setting it to
     * null in the catch arm of initWithWatchdog). Using a local
     * reference for the rest of doInit keeps the splice safe against
     * that race, and the `this.sonic !== sonic` check at the resume
     * point is the explicit late-resolve bailout.
     *
     * `coreBaseURL` points supersonic at the GPL core assets (WASM +
     * AudioWorklet from supersonic-scsynth-core); wasm resolves to
     * `coreBaseURL + 'wasm/'` and the worklet to `coreBaseURL +
     * 'workers/'` -- exactly the layout `npx underscore-sdk` copies
     * into the consumer's public dir. Since 0.70 all engine options go
     * to the constructor and `init()` takes no arguments.
     */
    /*
     * The module-level OSC encoder is captured here so timed playback
     * (the program bundle pump) can encode timestamped bundles
     * synchronously later, without re-importing the module.
     */
    this.osc = SuperSonic.osc;

    /*
     * Input/output bus channels are pinned to 2 because program
     * manifests hardcode private audio bus indices, which start at
     * numInputBusChannels + numOutputBusChannels = 4. Leaving these to
     * engine defaults would silently reroute captured buses.
     */
    const sonic = new SuperSonic({
      coreBaseURL: this.config.wasmBaseUrl,
      workerBaseURL: workerBaseUrl,
      scsynthOptions: {
        numBuffers: 256,
        realTimeMemorySize: 8192,
        numInputBusChannels: 2,
        numOutputBusChannels: 2,
      },
      audioContext: context ?? undefined,
      audioContextOptions: {
        latencyHint: "playback",
        sampleRate: 48000,
      },
    });
    this.sonic = sonic;

    const detachLoading = sonic.on?.("loading:complete", (data) => {
      if (data.type === "wasm" && this.initAttempt === attempt) resourcesReady();
    });
    try {
      await sonic.init();
    } finally {
      detachLoading?.();
    }

    if (this.sonic !== sonic || this.initAttempt !== attempt) {
      /*
       * Watchdog timeout already fired and detached this instance
       * while we were awaiting `sonic.init()`. The initWithWatchdog
       * catch arm already attempted a shutdown, but that ran while
       * the init promise was still pending and may not have
       * released everything sonic allocated as it finished resolving.
       * A second best-effort shutdown closes that window; we then
       * exit silently so the caller's rejection (already thrown by
       * the watchdog) is the only observable outcome.
       */
      try {
        await sonic.shutdown();
      } catch {
        /* older builds without `shutdown`: tolerated */
      }
      return;
    }

    this.masterGain = spliceMasterGain(sonic, this.masterVolume);
    const ctx = sonic.audioContext;
    if (ctx && this.masterGain && sonic.node) {
      this.playbackGain = ctx.createGain();
      sonic.node.disconnect(this.masterGain);
      sonic.node.connect(this.playbackGain);
      this.playbackGain.connect(this.masterGain);
    }
    if (ctx && this.masterGain && typeof ctx.createAnalyser === "function") {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.6;
      this.masterGain.connect(this.analyser);
    }
  }

  /**
   * Check if the engine is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the AudioContext, including the gesture-unlocked initialization context.
   */
  get audioContext(): AudioContext | null {
    return this.sonic?.audioContext || this.initializingContext;
  }

  /**
   * The underlying SuperSonic engine, or null before init(). Exposed for
   * the program transport, which needs timestamped-bundle scheduling
   * primitives (send/sendOSC/superClock/purge/sync) that are outside the
   * single-synth play/stop/setParam surface this class offers. There is
   * one engine per client, so program playback and single-synth playback
   * share it and must not run at the same time (each stops the other
   * before starting).
   *
   * @internal
   */
  get engine(): SuperSonic | null {
    return this.sonic;
  }

  /**
   * The module-level OSC bundle encoder, or null before init(). Timed
   * playback encodes timestamped bundles with it; it is captured at init
   * so those callers stay synchronous.
   *
   * @internal
   */
  resume(): Promise<void> {
    return resumeAudioContext(this.audioContext);
  }

  get playingNodeId(): number | null {
    return this._isPlaying ? this.currentNodeId : null;
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  /** @internal A transport envelope, independent of volume and synth parameters. */
  fadeIn(): void {
    const node = this.playbackGain;
    if (!node) return;
    const now = node.context.currentTime;
    const level = node.gain.value;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(level, now);
    node.gain.linearRampToValueAtTime(1, now + 0.02);
  }

  /** @internal Keep the graph alive until its output has reached silence. */
  async fadeOut(): Promise<void> {
    const node = this.playbackGain;
    if (!node) return;
    const now = node.context.currentTime;
    const level = node.gain.value;
    node.gain.cancelScheduledValues(now);
    if (node.context.state !== "running" || level === 0) {
      node.gain.setValueAtTime(0, now);
      return;
    }
    node.gain.setValueAtTime(level, now);
    node.gain.linearRampToValueAtTime(0, now + 0.02);
    // One extra render quantum lets the fade finish before OSC graph teardown.
    await this.sleep(25);
  }

  cacheParams(params: Record<string, number>): void {
    for (const [name, value] of Object.entries(params)) this.paramValues.set(name, value);
  }

  get oscEncoder(): OscBundleEncoder | null {
    return this.osc;
  }

  /**
   * Free named SynthDefs from the engine's RT memory. Callers that track
   * which defs they loaded (the program transport) must invoke this when
   * switching programs -- otherwise every distinct program played in a
   * session permanently accumulates in RT memory.
   */
  freeSynthDefs(names: readonly string[]): void {
    if (!this.sonic || names.length === 0) return;
    this.sonic.send("/d_free", ...names);
    this.log.debug(`Freed ${names.length} synthdef(s): ${names.join(", ")}`);
  }

  /**
   * Load a synthdef from binary data.
   *
   * Bytes are handed to the engine directly. This path has broken twice
   * behind URL indirection (blob: URLs rejected the engine's HEAD probe;
   * data: URLs carried base64 overhead and probe assumptions), and since
   * 0.70 `loadSynthDef` accepts raw ArrayBuffer as a first-class input,
   * so no URL encoding of any kind is warranted here.
   */
  async loadSynthdefFromData(data: ArrayBuffer): Promise<void> {
    await this.init();

    await this.sonic!.loadSynthDef(data);
  }

  /**
   * Load audio samples into buffers.
   * Must be called before playing a synth that uses samples.
   * Each sample is assigned to its specified buffer number.
   *
   * @param samples - Array of sample metadata with URLs
   */
  async loadSamples(samples: SampleMetadata[]): Promise<void> {
    if (!samples || samples.length === 0) return;

    /*
     * Validate URLs up-front, before any audio init work. Samples must
     * carry a fetchable `url` (a signed download URL returned by the
     * Underscore API). Silently skipping a sample with no URL would
     * hide a real API/SDK contract break -- the synth would load but
     * be silent with no obvious cause. Raise loudly so the caller
     * notices.
     */
    const missingUrl = samples.find((s) => !s.url);
    if (missingUrl) {
      throw new AudioError(
        `Sample "${missingUrl.id}" is missing url. The API synth metadata ` +
          `must include signed sample URLs; check that your Underscore API ` +
          `is up to date.`
      );
    }

    await this.init();

    for (const sample of samples) {
      if (this.loadedBuffers.has(sample.bufferNum)) {
        this.log.debug(`Buffer ${sample.bufferNum} already loaded, skipping`);
        continue;
      }

      try {
        this.log.debug(`Loading sample "${sample.id}" into buffer ${sample.bufferNum}`);
        await this.sonic!.loadSample(sample.bufferNum, sample.url!);
        this.loadedBuffers.add(sample.bufferNum);
        this.log.info(`Loaded sample "${sample.id}"`);
      } catch (error) {
        this.log.error(`Failed to load sample "${sample.id}":`, error);
        throw error;
      }
    }

    await this.sonic!.sync();
  }

  /**
   * Load a single sample from binary data.
   *
   * Bytes are handed to the engine directly for the same reason as
   * {@link loadSynthdefFromData}: since 0.70 `loadSample` accepts an
   * ArrayBuffer as a first-class input, so the previous Blob /
   * `createObjectURL` detour (and its HEAD-probe / revoke races) is
   * unnecessary.
   *
   * @param bufferNum - Buffer number to load into
   * @param data - Audio data as ArrayBuffer
   */
  async loadSampleFromData(bufferNum: number, data: ArrayBuffer): Promise<void> {
    await this.init();

    await this.sonic!.loadSample(bufferNum, data);
    this.loadedBuffers.add(bufferNum);

    await this.sonic!.sync();
  }

  /**
   * Clear all loaded buffers.
   * Call this when switching to a different synth.
   */
  clearBuffers(): void {
    this.loadedBuffers.clear();
  }

  /**
   * Play a synth by name.
   * The synthdef must be loaded first.
   */
  async play(synthName: string): Promise<void> {
    if (!this.sonic) {
      throw new AudioError("Audio not initialized. Call init() first.");
    }

    this.onBeforePlayback?.();

    await this.resume();

    // Stop current synth if playing
    if (this._isPlaying) {
      this.sonic.send("/n_free", this.currentNodeId);
    }

    /*
     * nextNodeId() allocates from supersonic's shared counter so voice
     * IDs never collide with other engine clients -- program manifests
     * bake their own node IDs into setup/events, and a locally
     * incremented counter could eventually land on one of them.
     */
    this.currentNodeId = this.sonic.nextNodeId();
    this.sonic.send("/s_new", synthName, this.currentNodeId, 0, 0);
    this.currentSynthName = synthName;
    this._isPlaying = true;
    this.paramValues.clear();
    this.notify();
  }

  /**
   * Stop the currently playing synth.
   */
  stop(): void {
    if (!this.sonic || !this._isPlaying) return;

    this.sonic.send("/n_free", this.currentNodeId);
    this._isPlaying = false;
    this.paramValues.clear();
    this.notify();
  }

  /**
   * Set a parameter value on the currently playing synth.
   */
  setParam(paramName: string, value: number): void {
    if (!this.sonic || !this._isPlaying) return;

    this.paramValues.set(paramName, value);
    this.sonic.send("/n_set", this.currentNodeId, paramName, value);
  }

  /**
   * Set multiple parameters at once.
   */
  setParams(params: Record<string, number>): void {
    if (!this.sonic || !this._isPlaying) return;

    const args: (string | number)[] = [this.currentNodeId];
    for (const [name, value] of Object.entries(params)) {
      this.paramValues.set(name, value);
      args.push(name, value);
    }

    this.sonic.send("/n_set", ...args);
  }

  /**
   * Set the engine master output level.
   *
   * Applies a single `GainNode` between the synth output bus and
   * `audioContext.destination`. Independent of per-synth `amp` cache
   * values, so layering master volume on top of per-voice amp
   * settings is safe.
   *
   * Clamps to `[0, 2]`; values outside that range are warned and
   * clamped (not thrown) so that a UI slider with a slightly off
   * upper bound doesn't break audio. Non-finite values (NaN /
   * Infinity) throw `ValidationError` because they almost always
   * indicate a UI bug a consumer should surface, not silently smooth.
   */
  setMasterVolume(value: number): void {
    const { value: clamped, warning } = clampMasterVolume(value);
    if (warning) {
      console.warn(warning);
    }
    this.masterVolume = clamped;
    if (!this.masterGain) {
      /*
       * The master GainNode is spliced in during `init()` through
       * Supersonic's public `node`/`audioContext` accessors. If
       * Supersonic ever renames or restructures those the splice
       * silently no-ops and `setMasterVolume` becomes a black hole.
       * Warn loudly so the regression surfaces in user reports. The
       * long-term fix is a public setMasterGain API in supersonic-scsynth.
       */
      console.warn(
        "[underscore-sdk] setMasterVolume called but master GainNode is not " +
          "spliced; value is cached and will apply once init() succeeds. If " +
          "this persists after init(), the audio engine's node/audioContext " +
          "shape may have changed."
      );
      return;
    }
    /*
     * setTargetAtTime with a 30 ms time-constant smooths slider drag
     * into a continuous amplitude curve. A bare `gain.value = x`
     * produces audible zipper noise on rapid moves because each frame
     * is a discrete step; the smoothed approach is universally cheap
     * and the lag is well below the JND for level changes.
     *
     * The GainNode's own `context` is the source of truth for
     * `currentTime` here -- it is by construction the same context
     * the worklet is wired into and cannot be null while the node
     * exists, so no extra null check is needed.
     */
    this.masterGain.gain.setTargetAtTime(
      clamped,
      this.masterGain.context.currentTime,
      MASTER_VOLUME_SMOOTHING_SEC
    );
  }

  /**
   * Get the current master output level. Returns the most recently
   * set (clamped) value, regardless of whether init has run yet.
   */
  getMasterVolume(): number {
    return this.masterVolume;
  }

  /**
   * Get the current value of a parameter.
   */
  getParam(paramName: string): number | undefined {
    return this.paramValues.get(paramName);
  }

  /**
   * Get all current parameter values.
   */
  getAllParams(): Record<string, number> {
    return Object.fromEntries(this.paramValues);
  }

  /**
   * Check if a synth is currently playing.
   */
  isPlaying(): boolean {
    return this._isPlaying;
  }

  /**
   * Toggle play/stop for the current synth.
   */
  async toggle(): Promise<void> {
    if (this._isPlaying) {
      this.stop();
    } else if (this.currentSynthName) {
      await this.play(this.currentSynthName);
    }
  }

  /**
   * Crossfade from the current synth to a new one.
   * Both synths run simultaneously during the transition.
   * The new synthdef must already be loaded.
   *
   * @param synthName - Name of the synth to crossfade to
   * @param durationSec - Duration of the crossfade in seconds (default: 3)
   * @param targetAmp - Target amplitude for the new synth (default: 0.3)
   */
  async crossfadeTo(
    synthName: string,
    durationSec: number = 3,
    targetAmp: number = 0.3
  ): Promise<void> {
    if (!this.sonic) {
      throw new AudioError("Audio not initialized. Call init() first.");
    }

    this.onBeforePlayback?.();

    await this.resume();

    if (this.crossfadeInProgress) {
      this.log.warn("Crossfade already in progress, forcing completion");
      if (this.outgoingNodeId !== null) {
        this.sonic.send("/n_free", this.outgoingNodeId);
        this.outgoingNodeId = null;
      }
    }

    this.crossfadeInProgress = true;
    const oldNodeId = this._isPlaying ? this.currentNodeId : null;
    const oldAmp = this.paramValues.get("amp") ?? targetAmp;

    this.currentNodeId = this.sonic.nextNodeId();
    const newNodeId = this.currentNodeId;

    this.sonic.send("/s_new", synthName, newNodeId, 0, 0, "amp", 0);

    this.currentSynthName = synthName;
    this._isPlaying = true;
    this.paramValues.clear();
    this.paramValues.set("amp", 0);
    this.notify();

    if (oldNodeId !== null) {
      this.outgoingNodeId = oldNodeId;
    }

    const steps = Math.max(1, Math.floor(durationSec * 30));
    const stepDuration = (durationSec * 1000) / steps;

    for (let i = 1; i <= steps; i++) {
      await this.sleep(stepDuration);

      if (!this.crossfadeInProgress) break;

      const progress = i / steps;
      const newAmp = targetAmp * progress;
      const fadeOutAmp = oldNodeId !== null ? oldAmp * (1 - progress) : 0;

      this.sonic.send("/n_set", newNodeId, "amp", newAmp);
      this.paramValues.set("amp", newAmp);

      if (oldNodeId !== null) {
        this.sonic.send("/n_set", oldNodeId, "amp", fadeOutAmp);
      }
    }

    if (oldNodeId !== null) {
      this.sonic.send("/n_free", oldNodeId);
      this.outgoingNodeId = null;
    }

    this.crossfadeInProgress = false;
    this.notify();
  }

  /**
   * Check if a crossfade is currently in progress.
   */
  isCrossfading(): boolean {
    return this.crossfadeInProgress;
  }

  /**
   * Cancel an in-progress crossfade and immediately switch to the new synth.
   */
  cancelCrossfade(): void {
    if (!this.crossfadeInProgress) return;

    this.crossfadeInProgress = false;

    if (this.outgoingNodeId !== null && this.sonic) {
      this.sonic.send("/n_free", this.outgoingNodeId);
      this.outgoingNodeId = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
