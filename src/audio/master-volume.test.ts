/**
 * Unit tests for the pure master-volume clamp policy.
 *
 * These are deliberately AudioEngine-free: the clamp helper is the
 * single source of truth for the "what counts as a valid master gain"
 * contract, and pinning it without instantiating the engine keeps the
 * policy tests fast, deterministic, and immune to changes in the
 * supersonic mock.
 *
 * The stateful side of master volume (cached value, GainNode smoothing,
 * pre-init buffering) is exercised in `src/audio.test.ts` and
 * `src/audio.master-volume.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { MASTER_VOLUME_MAX, MASTER_VOLUME_MIN, clampMasterVolume } from "./master-volume.js";
import { ValidationError } from "../errors.js";

describe("clampMasterVolume", () => {
  it("returns in-range values unchanged with no warning", () => {
    expect(clampMasterVolume(0)).toEqual({ value: 0, warning: null });
    expect(clampMasterVolume(1)).toEqual({ value: 1, warning: null });
    expect(clampMasterVolume(MASTER_VOLUME_MAX)).toEqual({
      value: MASTER_VOLUME_MAX,
      warning: null,
    });
  });

  it("clamps above the ceiling and reports a warning", () => {
    const result = clampMasterVolume(5);
    expect(result.value).toBe(MASTER_VOLUME_MAX);
    expect(result.warning).toMatch(/clamping/);
    expect(result.warning).toMatch(/5/);
  });

  it("clamps below the floor and reports a warning", () => {
    const result = clampMasterVolume(-1);
    expect(result.value).toBe(MASTER_VOLUME_MIN);
    expect(result.warning).toMatch(/clamping/);
    expect(result.warning).toMatch(/-1/);
  });

  it("throws ValidationError on NaN", () => {
    expect(() => clampMasterVolume(NaN)).toThrow(ValidationError);
  });

  it("throws ValidationError on Infinity", () => {
    expect(() => clampMasterVolume(Infinity)).toThrow(ValidationError);
  });

  it("throws ValidationError on -Infinity", () => {
    expect(() => clampMasterVolume(-Infinity)).toThrow(ValidationError);
  });
});
