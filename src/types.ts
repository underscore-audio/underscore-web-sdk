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
   * Get one at https://underscore.audio/settings
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
   * Example: '/supersonic/'
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
 * Interpolation curve for automation keyframes.
 */
export type AutomationCurve = "linear" | "exponential" | "hold";

/**
 * Automation keyframe for parameter automation.
 */
export interface AutomationKeyframe {
  /** Time in seconds from start */
  t: number;

  /** Parameter value at this time */
  value: number;

  /** Interpolation to next keyframe */
  curve?: AutomationCurve;
}

/**
 * Automation lane for a single parameter.
 */
export interface ParamAutomationLane {
  /** Parameter name to automate */
  param: string;

  /** Keyframes defining the automation curve */
  keyframes: AutomationKeyframe[];
}

/**
 * Automation plan for driving synth parameters over time.
 */
export interface AutomationPlan {
  /** Human-readable title */
  title: string;

  /** Total duration in seconds */
  durationSec: number;

  /** Optional notes about the automation */
  notes?: string;

  /** Parameter automation lanes */
  lanes: ParamAutomationLane[];
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
 * Full synth metadata including automation and samples.
 */
export interface SynthMetadata {
  /** Synth name (unique within composition) */
  name: string;

  /** Human-readable description */
  description: string;

  /** Parameter definitions */
  params: ParamMetadata[];

  /** Optional automation plan */
  automation?: AutomationPlan;

  /** Optional audio samples used by this synth */
  samples?: SampleMetadata[];

  /** Creation timestamp (ISO 8601) */
  createdAt: string;

  /** URL to download the compiled synthdef */
  synthdefUrl: string;
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
 */
export type GenerationEventType =
  | "thinking"   // LLM thinking/reasoning
  | "progress"   // Phase change or status update
  | "code"       // Streaming code output
  | "ready"      // Generation complete, synth ready
  | "error";     // Generation failed

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
}
