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
    init(options?: InitOptions): Promise<void>;
    loadSynthDef(url: string): Promise<void>;
    loadSample(bufferNum: number, url: string): Promise<void>;
    sync(): Promise<void>;
    send(command: string, ...args: (string | number)[]): void;
  }
}
