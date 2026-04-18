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
import {
  startGeneration,
  subscribeToGeneration,
  streamGeneration,
  type StartGenerationResult,
} from "./generation.js";
import { createLogger, type Logger } from "./debug.js";
import { SynthError } from "./errors.js";
import type {
  UnderscoreConfig,
  SynthSummary,
  SynthMetadata,
  Composition,
  CreateCompositionOptions,
  CreateCompositionResponse,
  GenerationEvent,
} from "./types.js";

export * from "./types.js";
export { Synth } from "./synth.js";
export { UnderscoreError, ApiError, AudioError, SynthError, ValidationError } from "./errors.js";
export {
  startGeneration,
  subscribeToGeneration,
  type StartGenerationOptions,
  type StartGenerationResult,
} from "./generation.js";

const DEFAULT_WASM_BASE_URL = "/supersonic/";
const DEFAULT_API_BASE_URL = "https://underscore.audio";

export class Underscore {
  private client: ApiClient;
  private engine: AudioEngine;
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
      metadata.samples
    );
    synth.markLoaded();

    return synth;
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
   */
  async startGeneration(
    compositionId: string,
    description: string
  ): Promise<StartGenerationResult> {
    const baseUrl = this.config.baseUrl || DEFAULT_API_BASE_URL;
    return startGeneration(baseUrl, this.config.apiKey, { compositionId, description });
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
   * @param compositionId   Optional. When provided, the SDK will auto-load the
   *                        finished synth on the terminal `ready` event and
   *                        attach it as `event.synth`, ready to `.play()`.
   *                        When omitted, consumers receive protocol events
   *                        only and can load the synth themselves via
   *                        {@link Underscore.loadSynth}.
   */
  async *subscribeToGeneration(
    streamUrlOrPath: string,
    compositionId?: string
  ): AsyncGenerator<GenerationEvent & { synth?: Synth }> {
    const baseUrl = this.config.baseUrl || DEFAULT_API_BASE_URL;

    for await (const event of subscribeToGeneration(streamUrlOrPath, baseUrl)) {
      if (event.type === "ready" && event.synthName && compositionId) {
        try {
          const synth = await this.loadSynth(compositionId, event.synthName);
          yield { ...event, synth };
        } catch (error) {
          yield {
            type: "error",
            error: error instanceof Error ? error.message : "Failed to load synth",
          };
        }
      } else {
        yield event;
      }
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
   */
  async *generate(
    compositionId: string,
    description: string
  ): AsyncGenerator<GenerationEvent & { synth?: Synth }> {
    const baseUrl = this.config.baseUrl || DEFAULT_API_BASE_URL;

    for await (const event of streamGeneration(baseUrl, this.config.apiKey, {
      compositionId,
      description,
    })) {
      if (event.type === "ready" && event.synthName) {
        try {
          const synth = await this.loadSynth(compositionId, event.synthName);
          yield { ...event, synth };
        } catch (error) {
          yield {
            type: "error",
            error: error instanceof Error ? error.message : "Failed to load synth",
          };
        }
      } else {
        yield event;
      }
    }
  }

  /**
   * Get the underlying AudioContext (if initialized).
   * Useful for advanced audio routing.
   */
  get audioContext(): AudioContext | null {
    return this.engine.audioContext;
  }
}

export default Underscore;
