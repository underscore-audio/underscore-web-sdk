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

import { describe, it, expect, vi } from "vitest";
import type { SuperSonic } from "supersonic-scsynth";
import {
  MASTER_VOLUME_MAX,
  MASTER_VOLUME_MIN,
  clampMasterVolume,
  spliceMasterGain,
} from "./master-volume.js";
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

describe("spliceMasterGain skipped path", () => {
  /*
   * The splice reaches through supersonic-scsynth's `workletNode`
   * field (private upstream, modelled in the SDK's local d.ts) to
   * insert a master GainNode. If upstream ever renames or drops that
   * field, the splice silently no-ops and the master bus is bypassed
   * -- audio still plays but `setMasterVolume` becomes a black hole.
   * The warn is the regression sentinel: a consumer report against
   * a future supersonic version will show this string in the console
   * and point straight at the broken splice. Pin it so the sentinel
   * itself cannot bit-rot.
   */
  it("returns null and warns when supersonic-scsynth exposes audioContext but no workletNode", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fakeCtx = {
        destination: {} as AudioNode,
        createGain: vi.fn(),
      } as unknown as AudioContext;
      const sonic = {
        audioContext: fakeCtx,
        workletNode: null,
      } as unknown as SuperSonic;

      const result = spliceMasterGain(sonic, 1);

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("master GainNode splice skipped")
      );
      /*
       * Ensure the warn message names workletNode/audioContext so a
       * future reader can grep straight from a user-supplied console
       * snippet to this splice. A regression that drops the hint would
       * make field reports much harder to triage.
       */
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("workletNode"));
      expect(fakeCtx.createGain).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
