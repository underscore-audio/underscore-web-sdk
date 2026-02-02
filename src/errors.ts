/**
 * Custom error classes for the Underscore SDK.
 *
 * These provide better error handling and clearer messages for consumers.
 */

/**
 * Base error class for all SDK errors.
 */
export class UnderscoreError extends Error {
  /**
   * Error code for programmatic handling.
   */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "UnderscoreError";
    this.code = code;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when an API request fails.
 */
export class ApiError extends UnderscoreError {
  /**
   * HTTP status code from the response.
   */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message, "API_ERROR");
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Error thrown when audio initialization or playback fails.
 */
export class AudioError extends UnderscoreError {
  constructor(message: string) {
    super(message, "AUDIO_ERROR");
    this.name = "AudioError";
  }
}

/**
 * Error thrown when a synth operation fails.
 */
export class SynthError extends UnderscoreError {
  constructor(message: string) {
    super(message, "SYNTH_ERROR");
    this.name = "SynthError";
  }
}

/**
 * Error thrown when schema validation fails.
 */
export class ValidationError extends UnderscoreError {
  /**
   * Detailed validation issues from Zod.
   */
  readonly issues: unknown[];

  constructor(message: string, issues: unknown[]) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.issues = issues;
  }
}
