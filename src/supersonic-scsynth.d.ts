/**
 * Type declarations for supersonic-scsynth.
 * This module doesn't ship its own types.
 */

declare module "supersonic-scsynth" {
  export interface SuperSonicOptions {
    workerBaseURL: string;
    wasmBaseURL: string;
  }

  export interface ScsynthOptions {
    numBuffers?: number;
    realTimeMemorySize?: number;
  }

  export interface AudioContextOptions {
    latencyHint?: "interactive" | "playback" | "balanced";
    sampleRate?: number;
  }

  export interface InitOptions {
    scsynthOptions?: ScsynthOptions;
    audioContextOptions?: AudioContextOptions;
  }

  export class SuperSonic {
    constructor(options: SuperSonicOptions);
    audioContext: AudioContext | null;
    /*
     * Private field on the upstream class but exposed in this .d.ts on
     * purpose: the SDK splices a master GainNode between the worklet
     * and AudioContext.destination during init. Modelling the field
     * here turns a future rename into a compile error at the splice
     * call site instead of a silent runtime no-op that bypasses the
     * master bus. Optional because pre-init / older supersonic builds
     * may not have populated it yet -- the runtime path warns.
     */
    workletNode: AudioNode | null;
    init(options?: InitOptions): Promise<void>;
    loadSynthDef(url: string): Promise<void>;
    loadSample(bufferNum: number, url: string): Promise<void>;
    sync(): Promise<void>;
    send(command: string, ...args: (string | number)[]): void;
    shutdown(): Promise<void>;
  }
}
