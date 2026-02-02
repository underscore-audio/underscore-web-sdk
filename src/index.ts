/**
 * Underscore SDK
 *
 * TypeScript SDK for loading and playing Underscore synths.
 *
 * @example
 * ```typescript
 * import { Underscore } from '@underscore/sdk';
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
import { streamGeneration } from "./generation.js";
import { createLogger, type Logger } from "./debug.js";
import { SynthError } from "./errors.js";
import type {
  UnderscoreConfig,
  SynthSummary,
  SynthMetadata,
  GenerationEvent,
} from "./types.js";

export * from "./types.js";
export { Synth, type PlayOptions } from "./synth.js";
export {
  AutomationRunner,
  clamp,
  valueAtTime,
  type AutomationRunnerOptions,
} from "./automation.js";
export {
  UnderscoreError,
  ApiError,
  AudioError,
  SynthError,
  ValidationError,
} from "./errors.js";

const DEFAULT_WASM_BASE_URL = "/supersonic/";

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
    // Get synth name if not provided
    let name = synthName;
    if (!name) {
      const synths = await this.client.listSynths(compositionId);
      if (synths.length === 0) {
        throw new SynthError("No synths found in composition");
      }
      name = synths[synths.length - 1].name;
    }

    // Get synth metadata
    const metadata = await this.client.getSynth(compositionId, name);

    // Clear any previously loaded buffers (from a different synth)
    this.engine.clearBuffers();

    // Load samples if present (must be done BEFORE loading synthdef)
    if (metadata.samples && metadata.samples.length > 0) {
      this.log.info(`Loading ${metadata.samples.length} samples...`);
      await this.engine.loadSamples(metadata.samples);
      this.log.info("Samples loaded");
    }

    // Fetch and load the synthdef
    const synthdefData = await this.client.fetchSynthdef(compositionId, name);
    await this.engine.loadSynthdefFromData(synthdefData, name);

    // Create and return the Synth object
    const synth = new Synth(
      this.engine,
      compositionId,
      name,
      metadata.description,
      metadata.params,
      metadata.automation,
      metadata.samples
    );
    synth.markLoaded();

    return synth;
  }

  /**
   * Generate a new synth using natural language.
   *
   * Yields events as the generation progresses.
   * When a 'ready' event is received, call loadSynth() to get the playable synth.
   *
   * @param compositionId - The composition to generate in
   * @param description - Natural language description of the sound
   */
  async *generate(
    compositionId: string,
    description: string
  ): AsyncGenerator<GenerationEvent & { synth?: Synth }> {
    const baseUrl = this.config.baseUrl || "https://underscore.audio";

    for await (const event of streamGeneration(baseUrl, this.config.apiKey, {
      compositionId,
      description,
    })) {
      if (event.type === "ready" && event.synthName) {
        // Load the synth and include it in the event
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
