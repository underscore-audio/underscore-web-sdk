/**
 * HTTP client for the Underscore API.
 * Handles API key authentication, request/response handling, and schema validation.
 */

import type { SynthSummary, SynthMetadata } from "./types.js";
import {
  ListSynthsResponseSchema,
  SynthMetadataSchema,
} from "./schemas.js";
import { ApiError, ValidationError } from "./errors.js";
import { ZodError } from "zod";

const DEFAULT_BASE_URL = "https://underscore.audio";

export class ApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || DEFAULT_BASE_URL;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Underscore-API-Key": this.apiKey,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new ApiError(
        errorBody.error || `API request failed: ${response.status}`,
        response.status
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Parse and validate a response with a Zod schema.
   * Throws ValidationError with detailed issues if validation fails.
   */
  private validate<T>(schema: { parse: (data: unknown) => T }, data: unknown): T {
    try {
      return schema.parse(data);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ValidationError(
          `Invalid API response: ${err.issues.map((i) => i.message).join(", ")}`,
          err.issues
        );
      }
      throw err;
    }
  }

  /**
   * List all synths in a composition.
   * Validates the API response against the expected schema.
   */
  async listSynths(compositionId: string): Promise<SynthSummary[]> {
    const data = await this.request<unknown>(`/api/v1/compositions/${compositionId}/synths`);
    const result = this.validate(ListSynthsResponseSchema, data);
    return result.synths;
  }

  /**
   * Get metadata for a specific synth.
   * Validates the API response against the expected schema.
   */
  async getSynth(compositionId: string, synthName: string): Promise<SynthMetadata> {
    const data = await this.request<unknown>(
      `/api/v1/compositions/${compositionId}/synths/${synthName}`
    );
    return this.validate(SynthMetadataSchema, data);
  }

  /**
   * Get the URL for downloading a synthdef.
   */
  getSynthdefUrl(compositionId: string, synthName: string): string {
    return `${this.baseUrl}/api/v1/compositions/${compositionId}/synths/${synthName}/synthdef`;
  }

  /**
   * Fetch synthdef binary data.
   */
  async fetchSynthdef(compositionId: string, synthName: string): Promise<ArrayBuffer> {
    const url = this.getSynthdefUrl(compositionId, synthName);

    const response = await fetch(url, {
      headers: {
        "Underscore-API-Key": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new ApiError(`Failed to fetch synthdef: ${response.status}`, response.status);
    }

    return response.arrayBuffer();
  }
}
