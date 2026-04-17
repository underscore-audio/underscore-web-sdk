/**
 * Public types for the Underscore SDK.
 */

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
   * Base URL where WASM files are served.
   * Must point to a directory containing the supersonic-scsynth dist files.
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
export type ParamType = string;

/**
 * Value scaling for parameter controls.
 */
export type ParamScale = "linear" | "log" | "exp";

/**
 * Parameter metadata for synth controls.
 */
export interface ParamMetadata {
  /** Parameter name (used in OSC messages) */
  name: string;

  /** Parameter type for UI hints */
  type: ParamType;

  /** Default value */
  default: number;

  /** Minimum value */
  min: number;

  /** Maximum value */
  max: number;

  /** Value scaling (default: linear) */
  scale?: ParamScale;

  /** Display unit (e.g., "Hz", "ms", "dB") */
  unit?: string;

  /** Human-readable description */
  description: string;
}

/**
 * Metadata for an audio sample used by a synth.
 * Samples are loaded as buffers and referenced in the SynthDef code via PlayBuf.ar.
 */
export interface SampleMetadata {
  /** Buffer number in SuperCollider (0, 1, 2...) */
  bufferNum: number;

  /** Sample identifier (e.g., "choir", "texture1") */
  id: string;

  /** Description of the sample */
  description: string;

  /** S3 key where sample is stored */
  s3Key: string;

  /** URL to download the sample (signed URL) */
  url?: string;

  /** Duration in seconds */
  durationSec: number;

  /** Number of channels (1 = mono, 2 = stereo) */
  channels: number;

  /** Sample rate (typically 48000) */
  sampleRate: number;

  /** Whether sample was generated with loop flag */
  loop: boolean;
}

/**
 * Synth summary returned from list endpoint.
 */
export interface SynthSummary {
  /** Synth name (unique within composition) */
  name: string;

  /** Human-readable description */
  description: string;

  /** Parameter definitions */
  params: ParamMetadata[];

  /** Creation timestamp (ISO 8601) */
  createdAt: string;
}

/**
 * Full synth metadata including samples.
 */
export interface SynthMetadata {
  /** Synth name (unique within composition) */
  name: string;

  /** Human-readable description */
  description: string;

  /** Parameter definitions */
  params: ParamMetadata[];

  /** Optional audio samples used by this synth */
  samples?: SampleMetadata[];

  /** Creation timestamp (ISO 8601) */
  createdAt: string;

  /** URL to download the compiled synthdef */
  synthdefUrl: string;
}

/**
 * Composition metadata from the API.
 */
export interface Composition {
  /** Composition ID */
  id: string;

  /** Visibility: "unlisted" | "public" | "private" */
  visibility?: string;

  /** Number of synths in this composition */
  synthCount?: number;

  /** Name of the most recently created synth */
  lastSynthName?: string | null;

  /** Creation timestamp (ISO 8601) */
  createdAt: string;

  /** Last updated timestamp (ISO 8601) */
  updatedAt?: string;
}

/**
 * Options for creating a new composition.
 */
export interface CreateCompositionOptions {
  /** Optional title */
  title?: string;

  /** Visibility: "unlisted" (default) or "public" */
  visibility?: "unlisted" | "public";
}

/**
 * Response from creating a composition.
 */
export interface CreateCompositionResponse {
  /** New composition ID */
  id: string;

  /** Title (if provided) */
  title?: string | null;

  /** Visibility setting */
  visibility: string;

  /** Creation timestamp */
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
