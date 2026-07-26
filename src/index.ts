/**
 * Underscore SDK
 *
 * TypeScript SDK for loading and playing Underscore synths.
 *
 * @example
 * ```typescript
 * import { Underscore } from '@underscore-audio/sdk';
 *
 * const client = new Underscore({
 *   apiKey: 'us_...',
 *   wasmBaseUrl: '/supersonic/',
 * });
 *
 * // List synths
 * const synths = await client.listSynths('cmp_abc123');
 *
 * // Load and play
 * const synth = await client.loadSynth('cmp_abc123', 'warm_pad');
 * await synth.play();
 * synth.setParam('cutoff', 2000);
 * synth.stop();
 * ```
 */

import { ApiClient } from "./client.js";
import { AudioEngine } from "./audio.js";
import { Synth } from "./synth.js";
import { Program, ProgramTransport } from "./program.js";
import {
  startGeneration,
  subscribeToGeneration,
  streamGeneration,
  type GenerationOptions,
  type StartGenerationResult,
} from "./generation.js";
import { createLogger, type Logger } from "./debug.js";
import { SynthError } from "./errors.js";
import type {
  UnderscoreConfig,
  SynthSummary,
  SynthMetadata,
  ProgramSummary,
  ProgramManifest,
  Composition,
  CreateCompositionOptions,
  CreateCompositionResponse,
  GenerationEvent,
} from "./types.js";

export * from "./types.js";
export { Synth } from "./synth.js";
export {
  Program,
  type ProgramPlaybackState,
  type ProgramProgress,
  type ProgramProgressListener,
} from "./program.js";
export { UnderscoreError, ApiError, AudioError, SynthError, ValidationError } from "./errors.js";
export {
  startGeneration,
  subscribeToGeneration,
  type GenerationOptions,
  type StartGenerationOptions,
  type StartGenerationResult,
  type SubscribeToGenerationOptions,
} from "./generation.js";

/**
 * Stream events from {@link Underscore.subscribeToGeneration} /
 * {@link Underscore.generate}. When auto-load is enabled, terminal
 * `ready` events are discriminated by `kind` and carry exactly one
 * attached artifact.
 */
export type ReadyWithProgram = GenerationEvent & {
  type: "ready";
  kind: "program";
  synthName: string;
  program: Program;
  synth?: never;
};

export type ReadyWithSynth = GenerationEvent & {
  type: "ready";
  kind: "synth";
  synthName: string;
  synth: Synth;
  program?: never;
};

export type GenerationStreamEvent = GenerationEvent | ReadyWithProgram | ReadyWithSynth;

export function isReadyWithProgram(event: GenerationStreamEvent): event is ReadyWithProgram {
  return (
    event.type === "ready" && event.kind === "program" && "program" in event && !!event.program
  );
}

export function isReadyWithSynth(event: GenerationStreamEvent): event is ReadyWithSynth {
  return event.type === "ready" && event.kind === "synth" && "synth" in event && !!event.synth;
}

const DEFAULT_WASM_BASE_URL = "/supersonic/";
const DEFAULT_API_BASE_URL = "https://underscore.audio";

export class Underscore {
  private client: ApiClient;
  private engine: AudioEngine;
  private programTransport: ProgramTransport;
  private config: UnderscoreConfig;
  private log: Logger;

  constructor(config: UnderscoreConfig) {
    this.config = config;
    this.log = createLogger("underscore", config.logLevel ?? "none");
    this.client = new ApiClient(config.apiKey, config.baseUrl);

    const wasmBaseUrl = config.wasmBaseUrl || DEFAULT_WASM_BASE_URL;
    this.engine = new AudioEngine({
      wasmBaseUrl,
      workerBaseUrl: config.workerBaseUrl,
      logger: createLogger("audio", config.logLevel ?? "none"),
    });

    /*
     * One engine, one audible owner: the transport silences single-synth
     * playback itself before starting a program, and this hook closes
     * the reverse direction -- a synth play() silences program playback.
     */
    this.programTransport = new ProgramTransport(this.engine);
    this.engine.onBeforePlayback = () => this.programTransport.interrupt();
  }

  /**
   * Initialize the audio engine.
   * Must be called before playing synths.
   * Should be called from a user interaction (click/tap) due to browser autoplay policies.
   */
  async init(): Promise<void> {
    await this.engine.init();
  }

  /**
   * Check if the audio engine is initialized.
   */
  isInitialized(): boolean {
    return this.engine.isInitialized();
  }

  /**
   * Create a new composition.
   */
  async createComposition(options?: CreateCompositionOptions): Promise<CreateCompositionResponse> {
    return this.client.createComposition(options);
  }

  /**
   * Get composition metadata.
   */
  async getComposition(compositionId: string): Promise<Composition> {
    return this.client.getComposition(compositionId);
  }

  /**
   * List all synths in a composition.
   */
  async listSynths(compositionId: string): Promise<SynthSummary[]> {
    return this.client.listSynths(compositionId);
  }

  /**
   * Get metadata for a specific synth.
   */
  async getSynth(compositionId: string, synthName: string): Promise<SynthMetadata> {
    return this.client.getSynth(compositionId, synthName);
  }

  /**
   * Load a synth for playback.
   *
   * Fetches the synthdef and loads it into the audio engine.
   * If the synth uses audio samples, they are loaded as buffers first.
   * The returned Synth object can be used for playback and parameter control.
   *
   * @param compositionId - The composition ID
   * @param synthName - The synth name (optional, defaults to the latest synth)
   */
  async loadSynth(compositionId: string, synthName?: string): Promise<Synth> {
    let name = synthName;
    if (!name) {
      const synths = await this.client.listSynths(compositionId);
      if (synths.length === 0) {
        throw new SynthError("No synths found in composition");
      }
      name = synths[synths.length - 1].name;
    }

    const metadata = await this.client.getSynth(compositionId, name);

    /*
     * Reload order matters: buffers must be cleared and samples uploaded
     * BEFORE the synthdef is loaded, otherwise the new synth can briefly
     * reference stale/missing buffer numbers on the server side.
     */
    this.engine.clearBuffers();
    if (metadata.samples && metadata.samples.length > 0) {
      this.log.info(`Loading ${metadata.samples.length} samples...`);
      await this.engine.loadSamples(metadata.samples);
      this.log.info("Samples loaded");
    }

    const synthdefData = await this.client.fetchSynthdef(compositionId, name);
    await this.engine.loadSynthdefFromData(synthdefData);

    const synth = new Synth(
      this.engine,
      compositionId,
      name,
      metadata.description,
      metadata.params,
      metadata.samples,
      metadata.score
    );
    synth.markLoaded();

    return synth;
  }

  /**
   * List all programs (multi-SynthDef pieces) in a composition.
   */
  async listPrograms(compositionId: string): Promise<ProgramSummary[]> {
    return this.client.listPrograms(compositionId);
  }

  /**
   * Fetch a program's full manifest without loading it for playback.
   * Manifests are large; prefer {@link Underscore.listPrograms} when
   * only display metadata is needed.
   */
  async getProgramManifest(compositionId: string, programName: string): Promise<ProgramManifest> {
    return this.client.getProgramManifest(compositionId, programName);
  }

  /**
   * Load a program for playback.
   *
   * Fetches the manifest and every synthdef it names, loads them into
   * the audio engine, and returns a {@link Program} handle for playback,
   * seeking, and progress subscription. Like {@link Underscore.loadSynth},
   * this boots the audio engine, so call it from (or after) a user
   * gesture in browsers.
   *
   * @param compositionId - The composition ID
   * @param programName - The program name (optional, defaults to the latest program)
   */
  async loadProgram(compositionId: string, programName?: string): Promise<Program> {
    let name = programName;
    if (!name) {
      const programs = await this.client.listPrograms(compositionId);
      if (programs.length === 0) {
        throw new SynthError("No programs found in composition");
      }
      name = programs[programs.length - 1].name;
    }
    const resolved = name;

    const manifest = await this.client.getProgramManifest(compositionId, resolved);

    const defs = new Map<string, ArrayBuffer>();
    await Promise.all(
      manifest.synthdefs.map(async (def) => {
        defs.set(def, await this.client.fetchProgramSynthdef(compositionId, resolved, def));
      })
    );

    const program = new Program(this.programTransport, compositionId, resolved, manifest, defs);
    await this.programTransport.ensureLoaded(program);

    this.log.info(
      `Loaded program ${resolved}: ${manifest.synthdefs.length} synthdefs, ` +
        `${manifest.events.length} events`
    );
    return program;
  }

  /**
   * Start a generation job. Server-side only.
   *
   * Requires a **secret** key (`us_sec_...`). Uses only `fetch`, so it
   * works in Node and any runtime with a global `fetch`. Return the
   * `streamUrl` to your browser client and have it call
   * {@link Underscore.subscribeToGeneration} to observe progress.
   *
   * This is the safe entry point for the backend-proxy pattern:
   * secret key never touches the browser.
   *
   * @param options Optional tuning knobs: `complexity` trades speed
   *   against musical richness (`"fast" | "balanced" | "rich"`);
   *   `model` pins a catalogue id (Anthropic / OpenAI / xAI). Omit
   *   both for the default single-shot behavior.
   */
  async startGeneration(
    compositionId: string,
    description: string,
    options: GenerationOptions = {}
  ): Promise<StartGenerationResult> {
    const baseUrl = this.config.baseUrl || DEFAULT_API_BASE_URL;
    return startGeneration(baseUrl, this.config.apiKey, { compositionId, description, ...options });
  }

  /**
   * Subscribe to a generation stream. Browser-only (requires `EventSource`).
   *
   * Accepts the relative `streamUrl` returned by
   * {@link Underscore.startGeneration} (or any absolute stream URL).
   * No API key is required; the stream is protected by the unguessable
   * `jobId` embedded in the URL.
   *
   * @param streamUrlOrPath Absolute or relative stream URL from `startGeneration`.
   * @param options         Optional bag:
   *   - `compositionId`: when provided, the SDK auto-loads the finished
   *     artifact on the terminal `ready` event — `event.synth` for
   *     `kind: "synth"` (default), or `event.program` for
   *     `kind: "program"`. When omitted, consumers receive protocol
   *     events only and can load via {@link Underscore.loadSynth} /
   *     {@link Underscore.loadProgram}.
   *   - `signal`: optional AbortSignal; aborting closes the SSE socket
   *     and ends the generator. Useful for canceling on effect teardown,
   *     navigation, or a watchdog timeout.
   */
  async *subscribeToGeneration(
    streamUrlOrPath: string,
    options: {
      compositionId?: string;
      signal?: AbortSignal;
      /** Fallback when a ready event omits `kind` (prefer setting this to the job's kind). */
      kind?: GenerationEvent["kind"];
    } = {}
  ): AsyncGenerator<GenerationStreamEvent> {
    const baseUrl = this.config.baseUrl || DEFAULT_API_BASE_URL;
    const { compositionId, signal, kind: kindHint } = options;

    for await (const event of subscribeToGeneration(streamUrlOrPath, { baseUrl, signal })) {
      yield* this.attachReadyArtifact(event, compositionId, kindHint);
    }
  }

  /**
   * Legacy combined generation flow.
   *
   * Chains {@link Underscore.startGeneration} and
   * {@link Underscore.subscribeToGeneration} in a single call. This is
   * only usable in "trusted" environments that have BOTH network access
   * capable of using a secret key AND an `EventSource` global (e.g. a
   * Node CLI with an EventSource polyfill, or an Electron app).
   *
   * Third-party browser apps must use the backend-proxy pattern instead:
   * run `startGeneration` on your server, forward the returned
   * `streamUrl` to the browser, and call `subscribeToGeneration` there.
   *
   * @param options Optional tuning knobs, see {@link Underscore.startGeneration}.
   */
  async *generate(
    compositionId: string,
    description: string,
    options: GenerationOptions = {}
  ): AsyncGenerator<GenerationStreamEvent> {
    const baseUrl = this.config.baseUrl || DEFAULT_API_BASE_URL;

    for await (const event of streamGeneration(baseUrl, this.config.apiKey, {
      compositionId,
      description,
      ...options,
    })) {
      yield* this.attachReadyArtifact(event, compositionId, options.kind);
    }
  }

  /**
   * On terminal `ready`, optionally auto-load the finished synth or program.
   * `kindHint` covers streams that omit `kind` on complete (legacy synth).
   */
  private async *attachReadyArtifact(
    event: GenerationEvent,
    compositionId: string | undefined,
    kindHint?: GenerationEvent["kind"]
  ): AsyncGenerator<GenerationStreamEvent> {
    if (event.type !== "ready" || !event.synthName || !compositionId) {
      yield event;
      return;
    }
    const kind = event.kind ?? kindHint ?? "synth";
    try {
      if (kind === "program") {
        const program = await this.loadProgram(compositionId, event.synthName);
        const ready: ReadyWithProgram = {
          ...event,
          type: "ready",
          kind: "program",
          synthName: event.synthName,
          program,
        };
        yield ready;
      } else {
        const synth = await this.loadSynth(compositionId, event.synthName);
        const ready: ReadyWithSynth = {
          ...event,
          type: "ready",
          kind: "synth",
          synthName: event.synthName,
          synth,
        };
        yield ready;
      }
    } catch (error) {
      yield {
        type: "error",
        error:
          error instanceof Error
            ? error.message
            : kind === "program"
              ? "Failed to load program"
              : "Failed to load synth",
      };
    }
  }

  /**
   * Get the underlying AudioContext (if initialized).
   * Useful for advanced audio routing.
   */
  get audioContext(): AudioContext | null {
    return this.engine.audioContext;
  }

  /**
   * Set the master output volume.
   *
   * Thin pass-through to the audio engine's master `GainNode`.
   * Accepts `[0, 2]`; values outside that range are clamped (with a
   * console warning). Non-finite values throw `ValidationError`.
   * Safe to call before `init()` -- the value is cached and applied
   * when the audio graph comes up.
   */
  setMasterVolume(value: number): void {
    this.engine.setMasterVolume(value);
  }

  /**
   * Get the current master output volume. Defaults to 1.0 before any
   * `setMasterVolume` call.
   */
  getMasterVolume(): number {
    return this.engine.getMasterVolume();
  }
}

export default Underscore;
