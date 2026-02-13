/**
 * Zod schemas for runtime validation of API responses.
 *
 * These schemas ensure that API responses match expected shapes,
 * providing clear error messages when the API contract changes.
 *
 * API Contract Reference:
 * https://github.com/po-studio/underscore/blob/main/api/src/contracts/sdk-api.ts
 *
 * These schemas must match the API contract defined in the underscore monorepo.
 * If the API changes, update these schemas accordingly.
 */

import { z } from "zod";

/**
 * Parameter type - accepts any string since synths can define custom types.
 * Common types: amp, freq, time, tempo, control, switch, factor, musical, generic, bpm
 */
export const ParamTypeSchema = z.string();

export const ParamScaleSchema = z.enum(["linear", "log", "exp"]);

export const ParamMetadataSchema = z.object({
  name: z.string(),
  type: ParamTypeSchema,
  default: z.number(),
  min: z.number(),
  max: z.number(),
  scale: ParamScaleSchema.optional(),
  unit: z.string().optional(),
  description: z.string(),
});





export const SampleMetadataSchema = z.object({
  bufferNum: z.number(),
  id: z.string(),
  description: z.string(),
  s3Key: z.string(),
  url: z.string().optional(),
  durationSec: z.number(),
  channels: z.number(),
  sampleRate: z.number(),
  loop: z.boolean(),
});

export const SynthSummarySchema = z.object({
  name: z.string(),
  description: z.string(),
  params: z.array(ParamMetadataSchema),
  createdAt: z.string(),
});

export const SynthMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  params: z.array(ParamMetadataSchema),
  samples: z.array(SampleMetadataSchema).optional(),
  createdAt: z.string(),
  synthdefUrl: z.string(),
});

export const ListSynthsResponseSchema = z.object({
  synths: z.array(SynthSummarySchema),
});

export const GenerateResponseSchema = z.object({
  streamUrl: z.string(),
});
