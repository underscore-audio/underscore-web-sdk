/**
 * Zod schemas for runtime validation of API responses.
 *
 * These schemas ensure that API responses match expected shapes,
 * providing clear error messages when the API contract changes.
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

export const AutomationCurveSchema = z.enum(["linear", "exponential", "hold"]);

export const AutomationKeyframeSchema = z.object({
  t: z.number(),
  value: z.number(),
  curve: AutomationCurveSchema.optional(),
});

export const ParamAutomationLaneSchema = z.object({
  param: z.string(),
  keyframes: z.array(AutomationKeyframeSchema),
});

export const AutomationPlanSchema = z.object({
  title: z.string(),
  durationSec: z.number(),
  notes: z.string().optional(),
  lanes: z.array(ParamAutomationLaneSchema),
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
  automation: AutomationPlanSchema.optional(),
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
