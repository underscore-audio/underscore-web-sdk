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

  export interface SuperSonicOptions {
    /** Convenience shorthand when all assets are co-located. */
    baseURL?: string;
    /** Base URL for GPL assets: WASM + AudioWorklet (supersonic-scsynth-core). */
    coreBaseURL?: string;
    /** Base URL for MIT worker scripts. Defaults to `baseURL + 'workers/'`. */
    workerBaseURL?: string;
    /** Base URL for WASM files. Defaults to `coreBaseURL + 'wasm/'`. */
    wasmBaseURL?: string;
    /** 'postMessage' (default, no special headers) or 'sab' (needs COOP/COEP). */
    mode?: "postMessage" | "sab";
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
    /** Available after init(). */
    get audioContext(): AudioContext | null;
    /** Available after init(); null before. */
    get node(): SuperSonicNode | null;
    init(): Promise<void>;
    /**
     * Result shapes (LoadSynthDefResult / LoadSampleResult) are ignored
     * by the SDK, so they are deliberately not modelled here.
     */
    loadSynthDef(source: string | ArrayBuffer | ArrayBufferView | Blob): Promise<unknown>;
    loadSample(bufferNum: number, url: string): Promise<unknown>;
    sync(syncId?: number): Promise<void>;
    send(command: string, ...args: (string | number)[]): void;
    shutdown(): Promise<void>;
  }
}
