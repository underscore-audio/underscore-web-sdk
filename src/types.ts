/**
 * Public types for the Underscore SDK.
 */

import type {
  ParamType as GeneratedParamType,
  ParamScale as GeneratedParamScale,
  ParamMetadata as GeneratedParamMetadata,
  SampleMetadata as GeneratedSampleMetadata,
  ScoreCurve as GeneratedScoreCurve,
  ScoreEvent as GeneratedScoreEvent,
  SynthScore as GeneratedSynthScore,
  SynthSummary as GeneratedSynthSummary,
  SynthMetadata as GeneratedSynthMetadata,
  CompositionResponse as GeneratedComposition,
  CreateCompositionRequest as GeneratedCreateCompositionOptions,
  CreateCompositionResponse as GeneratedCreateCompositionResponse,
} from "./generated/api-types.js";

/**
 * Log level for SDK debug output.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

/**
 * Configuration for the Underscore SDK.
 */
export interface UnderscoreConfig {
  /**
   * API key for authentication.
   *
   * Use a **publishable** key (`us_pub_...`) for browser/client-side code.
   * Use a **secret** key (`us_sec_...`) only in server-side code.
   *
   * Get one at https://underscore.audio (auto-created on signup).
   */
  apiKey: string;

  /**
   * Base URL for the Underscore API.
   * Defaults to https://underscore.audio
   */
  baseUrl?: string;

  /**
   * Base URL where the supersonic runtime files are served.
   * Must point to a directory with the layout `npx underscore-sdk`
   * produces: `wasm/` (scsynth engine from supersonic-scsynth-core)
   * and `workers/` (OSC workers + AudioWorklet).
   * Example: '/supersonic/'.
   *
   * Only consumed when you call `init()` or `loadSynth()`. Server-side
   * Node usage (e.g. calling `startGeneration` from a backend proxy)
   * never touches the audio engine, so this field can be omitted there.
   * Defaults to '/supersonic/'.
   */
  wasmBaseUrl?: string;

  /**
   * Base URL where worker files are served.
   * Defaults to wasmBaseUrl + 'workers/'
   */
  workerBaseUrl?: string;

  /**
   * Log level for debug output.
   * Set to 'debug' or 'info' to see SDK internals.
   * Defaults to 'none' (silent).
   */
  logLevel?: LogLevel;
}

/**
 * Parameter type classification.
 * Determines appropriate UI controls and value scaling.
 */
export type ParamType = GeneratedParamType;

/**
 * Value scaling for parameter controls.
 */
export type ParamScale = GeneratedParamScale;

/**
 * Parameter metadata for synth controls.
 */
export interface ParamMetadata extends GeneratedParamMetadata {
  /** Parameter name (used in OSC messages). */
  name: string;

  /** Parameter type for UI hints. */
  type: ParamType;

  /** Default value. */
  default: number;

  /** Minimum value. */
  min: number;

  /** Maximum value. */
  max: number;

  /** Value scaling. Defaults to linear when omitted. */
  scale?: ParamScale;

  /** Display unit, such as "Hz", "ms", or "dB". */
  unit?: string;

  /** Human-readable description. */
  description: string;
}

/**
 * Metadata for an audio sample used by a synth.
 * Samples are loaded as buffers and referenced in the SynthDef code via PlayBuf.ar.
 */
export interface SampleMetadata extends GeneratedSampleMetadata {
  /** Buffer number in SuperCollider: 0, 1, 2, and so on. */
  bufferNum: number;

  /** Sample identifier, such as "choir" or "texture1". */
  id: string;

  /** Description of the sample. */
  description: string;

  /** Storage key where the sample is stored. */
  s3Key: string;

  /** URL to download the sample, when one is available. */
  url?: string;

  /** Duration in seconds. */
  durationSec: number;

  /** Number of channels: 1 for mono, 2 for stereo. */
  channels: number;

  /** Sample rate, typically 48000. */
  sampleRate: number;

  /** Whether the sample was generated with a loop flag. */
  loop: boolean;
}

/**
 * Synth summary returned from list endpoint.
 */
export interface SynthSummary extends GeneratedSynthSummary {
  /** Synth name, unique within a composition. */
  name: string;

  /** Human-readable description. */
  description: string;

  /** Parameter definitions. */
  params: ParamMetadata[];

  /** Creation timestamp as an ISO 8601 string. */
  createdAt: string;
}

/**
 * Interpolation curve for the transition into a score event:
 *
 *   - `step` (default): jump to the new params at `tMs`.
 *   - `linear`: ramp each numeric param from the prior event's
 *     value (or the synth default at t=0) to the target value over
 *     the gap between events. Intermediate `setParams` calls are
 *     emitted at the scheduler's internal tick rate so audible
 *     parameter motion is smooth instead of stepped.
 *   - `exp`: same shape as `linear` but with an exponential curve,
 *     `start * (end/start)^t`, which matches SuperCollider's `\exp`
 *     envelope and is the right curve for pitch- and amp-like
 *     params. Falls back to linear when an endpoint is zero or the
 *     endpoints have opposite signs.
 */
export type ScoreCurve = GeneratedScoreCurve;

/**
 * One event in a score timeline. Fires at `tMs` and sets each
 * `params` entry on the running synth (equivalent to `setParams`).
 */
export interface ScoreEvent extends GeneratedScoreEvent {
  tMs: number;
  params: Record<string, number>;
  curve?: ScoreCurve;
}

/**
 * Score timeline that performs a synth over time. Emitted by the
 * generation pipeline alongside the SynthDef and played back by
 * the SDK when `synth.play()` is called.
 */
export interface SynthScore extends GeneratedSynthScore {
  totalDurationSec: number;
  events: ScoreEvent[];
}

/**
 * Full synth metadata including samples.
 */
export interface SynthMetadata extends GeneratedSynthMetadata {
  /** Synth name, unique within a composition. */
  name: string;

  /** Human-readable description. */
  description: string;

  /** Parameter definitions. */
  params: ParamMetadata[];

  /** Optional audio samples used by this synth. */
  samples?: SampleMetadata[];

  /**
   * Optional score that performs the synth over time. When present
   * `synth.play()` automatically starts the scheduler that sets
   * exposed params at each event's `tMs` offset. Omitted on synths
   * generated before scores existed; those play to their defaults.
   */
  score?: SynthScore;

  /** Creation timestamp as an ISO 8601 string. */
  createdAt: string;

  /** URL to download the compiled synthdef. */
  synthdefUrl: string;
}

/**
 * Composition metadata from the API.
 */
export interface Composition extends GeneratedComposition {
  /** Composition ID. */
  id: string;

  /** Visibility of the composition. */
  visibility?: "private" | "unlisted" | "public";

  /** Number of synths in this composition. */
  synthCount?: number;

  /** Name of the most recently created synth. */
  lastSynthName?: string | null;

  /** Creation timestamp as an ISO 8601 string. */
  createdAt: string;

  /** Last updated timestamp as an ISO 8601 string. */
  updatedAt?: string;
}

/**
 * Options for creating a new composition.
 */
export interface CreateCompositionOptions extends GeneratedCreateCompositionOptions {
  /** Optional title. */
  title?: string;

  /** Visibility for the new composition. Defaults to "unlisted". */
  visibility?: "unlisted" | "public";
}

/**
 * Response from creating a composition.
 */
export interface CreateCompositionResponse extends GeneratedCreateCompositionResponse {
  /** New composition ID. */
  id: string;

  /** Title, if provided. */
  title?: string | null;

  /** Visibility setting. */
  visibility: "unlisted" | "public";

  /** Creation timestamp as an ISO 8601 string. */
  createdAt: string;
}

/**
 * Synth playback state.
 */
export interface SynthState {
  /** Whether the synth is currently playing */
  playing: boolean;

  /** Name of the loaded synth (null if none) */
  synthName: string | null;

  /** Current parameter values */
  paramValues: Record<string, number>;
}

/**
 * Listener for synth state changes.
 */
export type SynthStateListener = (state: SynthState) => void;

/**
 * Generation event types.
 *
 * The SDK normalizes server SSE events into a small, stable union. The
 * `raw` variant is an escape hatch for server events that don't yet have
 * a first-class variant: it carries the unmapped server payload so power
 * users can introspect the full protocol without SDK changes.
 */
export type GenerationEventType =
  /** LLM reasoning chunk. `content` holds the partial text. */
  | "thinking"
  /** Phase/status change (e.g. "compiling"). `content` holds the label. */
  | "progress"
  /** Streaming SuperCollider code chunk. `content` holds the partial text. */
  | "code"
  /** Generation complete. `synthName` identifies the new synth. */
  | "ready"
  /** Generation failed or was declined. `error` holds the message. */
  | "error"
  /** Unmapped server event. `raw` holds the unmodified payload. */
  | "raw";

/**
 * Event emitted during synth generation.
 */
export interface GenerationEvent {
  /** Event type */
  type: GenerationEventType;

  /** Content for thinking/progress/code events */
  content?: string;

  /** Synth name for ready events */
  synthName?: string;

  /** Error message for error events */
  error?: string;

  /**
   * Raw, unmapped server event payload for `type: "raw"` events.
   * Shape is not versioned and may change -- use with care.
   */
  raw?: Record<string, unknown>;
}
