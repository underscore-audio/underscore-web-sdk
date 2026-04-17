/**
 * Audio engine wrapping Supersonic (scsynth WASM).
 *
 * This module manages the WebAssembly-based SuperCollider audio engine,
 * handling initialization, synthdef loading, sample loading, playback, and parameter control.
 */

import type { SynthState, SynthStateListener, SampleMetadata } from "./types.js";
import type { SuperSonic } from "supersonic-scsynth";
import { type Logger, noopLogger } from "./debug.js";
import { AudioError } from "./errors.js";

export interface AudioEngineConfig {
  wasmBaseUrl: string;
  workerBaseUrl?: string;
  logger?: Logger;
}

export class AudioEngine {
  private sonic: SuperSonic | null = null;
  private currentNodeId = 1000;
  private currentSynthName: string | null = null;
  private _isPlaying = false;
  private initPromise: Promise<void> | null = null;
  private listeners: Set<SynthStateListener> = new Set();
  private paramValues: Map<string, number> = new Map();
  private config: AudioEngineConfig;
  private loadedBuffers: Set<number> = new Set();
  private crossfadeInProgress = false;
  private outgoingNodeId: number | null = null;
  private log: Logger;

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

  private notify() {
    const state = this.state;
    this.listeners.forEach((l) => l(state));
  }

  /**
   * Initialize the audio engine.
   * Must be called before playing synths.
   * Should be called from a user interaction (click/tap) due to browser autoplay policies.
   */
  async init(): Promise<void> {
    if (this.sonic) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const { SuperSonic } = await import("supersonic-scsynth");

    const workerBaseUrl =
      this.config.workerBaseUrl || `${this.config.wasmBaseUrl}workers/`;

    this.sonic = new SuperSonic({
      workerBaseURL: workerBaseUrl,
      wasmBaseURL: `${this.config.wasmBaseUrl}wasm/`,
    });

    await this.sonic.init({
      scsynthOptions: {
        numBuffers: 256,
        realTimeMemorySize: 8192,
      },
      audioContextOptions: {
        latencyHint: "playback",
        sampleRate: 48000,
      },
    });

    this.notify();
  }

  /**
   * Check if the engine is initialized.
   */
  isInitialized(): boolean {
    return !!this.sonic;
  }

  /**
   * Get the underlying AudioContext (if initialized).
   */
  get audioContext(): AudioContext | null {
    return this.sonic?.audioContext || null;
  }

  /**
   * Load a synthdef from binary data.
   */
  async loadSynthdefFromData(data: ArrayBuffer): Promise<void> {
    await this.init();

    const blob = new Blob([data], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);

    try {
      await this.sonic!.loadSynthDef(url);
    } finally {
      URL.revokeObjectURL(url);
    }
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
     * carry a fetchable `url` (typically a signed S3 URL from the SDK
     * synth endpoint). Silently skipping a sample with no URL would hide
     * a real API/SDK contract break -- the synth would load but be silent
     * with no obvious cause. Raise loudly so the caller notices.
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
   * @param bufferNum - Buffer number to load into
   * @param data - Audio data as ArrayBuffer
   */
  async loadSampleFromData(bufferNum: number, data: ArrayBuffer): Promise<void> {
    await this.init();

    const blob = new Blob([data], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);

    try {
      await this.sonic!.loadSample(bufferNum, url);
      this.loadedBuffers.add(bufferNum);
    } finally {
      URL.revokeObjectURL(url);
    }

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

    const ctx = this.sonic.audioContext as AudioContext;
    if (ctx?.state === "suspended") {
      await ctx.resume();
    }

    // Stop current synth if playing
    if (this._isPlaying) {
      this.sonic.send("/n_free", this.currentNodeId);
    }

    this.currentNodeId++;
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

    const ctx = this.sonic.audioContext as AudioContext;
    if (ctx?.state === "suspended") {
      await ctx.resume();
    }

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

    this.currentNodeId++;
    const newNodeId = this.currentNodeId;

    this.sonic.send("/s_new", synthName, newNodeId, 0, 0, "amp", 0);

    this.currentSynthName = synthName;
    this._isPlaying = true;
    this.paramValues.clear();
    this.paramValues.set("amp", 0);

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

  /**
   * Play a synth with initial amp=0 (for manual crossfade control).
   */
  async playMuted(synthName: string): Promise<number> {
    if (!this.sonic) {
      throw new AudioError("Audio not initialized. Call init() first.");
    }

    const ctx = this.sonic.audioContext as AudioContext;
    if (ctx?.state === "suspended") {
      await ctx.resume();
    }

    this.currentNodeId++;
    const nodeId = this.currentNodeId;

    this.sonic.send("/s_new", synthName, nodeId, 0, 0, "amp", 0);

    return nodeId;
  }

  /**
   * Set a parameter on a specific node (for crossfade control).
   */
  setParamOnNode(nodeId: number, paramName: string, value: number): void {
    if (!this.sonic) return;
    this.sonic.send("/n_set", nodeId, paramName, value);
  }

  /**
   * Free a specific node.
   */
  freeNode(nodeId: number): void {
    if (!this.sonic) return;
    this.sonic.send("/n_free", nodeId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
