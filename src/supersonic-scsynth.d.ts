/**
 * Type declarations for supersonic-scsynth (0.70+ surface).
 *
 * The package ships its own supersonic.d.ts, but its exports map has no
 * `types` condition, so TypeScript cannot resolve it through the module
 * specifier. We vendor declarations for exactly the surface the SDK
 * consumes; anything modelled here that upstream renames becomes a
 * compile error at the call site instead of a silent runtime breakage.
 *
 * Since the 0.6x split, runtime assets come from two packages:
 * `supersonic-scsynth` (MIT JS client + OSC workers) and
 * `supersonic-scsynth-core` (GPL scsynth WASM + AudioWorklet). Only the
 * former is imported; core is asset-only and referenced by URL at
 * runtime, so no module declaration exists for it.
 */

declare module "supersonic-scsynth" {
  export interface ScsynthOptions {
    numBuffers?: number;
    realTimeMemorySize?: number;
    numInputBusChannels?: number;
    numOutputBusChannels?: number;
  }

  /**
   * NTP-derived audio clock. `now()` is the timebase timestamped OSC
   * bundles are scheduled against; anchoring playback on it (instead of
   * performance.now) is what makes bundle replay immune to main-thread
   * jitter.
   */
  export interface SuperClock {
    now(): number;
  }

  /**
   * Static OSC bundle encoder exposed as `SuperSonic.osc`. Only the
   * bundle path is modelled; single-message sends go through
   * `SuperSonic.send`.
   */
  export interface OscBundleEncoder {
    encodeBundle(timeTag: number, packets: Array<[string, ...Array<string | number>]>): Uint8Array;
  }

  export interface SuperSonicOptions {
    /** Base URL for GPL assets: WASM + AudioWorklet (supersonic-scsynth-core). */
    coreBaseURL?: string;
    /** Base URL for MIT worker scripts. */
    workerBaseURL?: string;
    /** Engine options passed to scsynth World_New(). */
    scsynthOptions?: ScsynthOptions;
    /** Options passed to `new AudioContext()`. */
    audioContextOptions?: AudioContextOptions;
  }

  /**
   * Wrapper over the engine's AudioWorkletNode exposed for custom audio
   * routing (the upstream-blessed seam the SDK uses to splice its master
   * GainNode between the engine output and the destination).
   */
  export interface SuperSonicNode {
    connect(destination: AudioNode): AudioNode;
    disconnect(destination?: AudioNode): void;
    readonly context: BaseAudioContext;
  }

  export class SuperSonic {
    constructor(options?: SuperSonicOptions);
    /** Module-level OSC encoder used for timestamped bundle playback. */
    static osc: OscBundleEncoder;
    /** Available after init(). */
    get audioContext(): AudioContext | null;
    /** Available after init(); null before. */
    get node(): SuperSonicNode | null;
    /** Available after init(); throws before. */
    get superClock(): SuperClock;
    init(): Promise<void>;
    /**
     * Result shapes (LoadSynthDefResult / LoadSampleResult) are ignored
     * by the SDK, so they are deliberately not modelled here.
     */
    loadSynthDef(source: string | ArrayBuffer | ArrayBufferView | Blob): Promise<unknown>;
    loadSample(
      bufferNum: number,
      source: string | ArrayBuffer | ArrayBufferView | Blob
    ): Promise<unknown>;
    sync(syncId?: number): Promise<void>;
    send(command: string, ...args: (string | number)[]): void;
    /** Send a pre-encoded OSC packet (timestamped bundles). */
    sendOSC(oscData: Uint8Array | ArrayBuffer): void;
    /** Flush the engine's scheduled-bundle queue and IN ring. */
    purge(): Promise<void>;
    /** Shared node-ID allocator; use it so engine clients never collide. */
    nextNodeId(): number;
    shutdown(): Promise<void>;
  }
}
