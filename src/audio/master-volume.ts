/**
 * Master-bus volume policy: constants + a pure clamp helper.
 *
 * Lives in its own file because the clamp policy (ceiling rationale,
 * smoothing tau, default value) is a self-contained contract that
 * deserves direct unit-test coverage without instantiating the audio
 * engine, and because it is the most cleanly extractable piece of
 * audio.ts. The stateful methods (`setMasterVolume`, `getMasterVolume`)
 * stay on `AudioEngine` -- they mutate engine private state and
 * factoring them into free functions only spreads the state, it does
 * not reduce it.
 */

import type { SuperSonic } from "supersonic-scsynth";
import { ValidationError } from "../errors.js";

/*
 * Master volume ceiling rationale.
 *
 * Every voice the SDK plays ends in `Limiter.ar(sig * amp, 0.5, 0.01)`
 * with per-UGen `mul <= 0.15`, so a single voice peaks at ~0.5 of
 * WebAudio full-scale (~-6 dBFS). A master gain of 2.0 brings the
 * limited peaks up to 1.0 (the WebAudio clip ceiling). Above 2.0 we'd
 * be clipping audibly even on already-limiter-clamped content, which
 * is never what we want -- cap there and warn rather than letting
 * consumers ship a distorted output by mistake.
 */
export const MASTER_VOLUME_MAX = 2.0;
export const MASTER_VOLUME_MIN = 0;
export const MASTER_VOLUME_DEFAULT = 1.0;

/*
 * 30 ms is well below the perceptual fusion floor for amplitude
 * changes but long enough to smear the discrete steps produced by a
 * UI slider into a continuous ramp, so the user hears the level
 * change as a single smooth motion instead of a zipper.
 */
export const MASTER_VOLUME_SMOOTHING_SEC = 0.03;

export interface ClampedMasterVolume {
  /** The clamped value, safe to push at the WebAudio GainNode. */
  value: number;
  /**
   * Human-readable warning when the input was clamped (out of range),
   * or `null` when the input was already in range. Callers should
   * `console.warn` it; we deliberately do not warn from inside this
   * pure helper so test code can exercise the clamp policy without
   * mocking the console.
   */
  warning: string | null;
}

/**
 * Validate + clamp a master-volume value.
 *
 * Throws `ValidationError` for non-finite inputs (NaN / Infinity)
 * because those almost always indicate a UI bug a consumer should
 * surface, not silently smooth. Returns a `{ value, warning }` pair
 * for in-range / out-of-range cases so the caller decides whether to
 * log the warning (the engine does; tests typically don't).
 */
export function clampMasterVolume(value: number): ClampedMasterVolume {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`setMasterVolume(value) requires a finite number, got ${value}`, []);
  }
  if (value > MASTER_VOLUME_MAX) {
    return {
      value: MASTER_VOLUME_MAX,
      warning: `[underscore-sdk] setMasterVolume(${value}) above ceiling ${MASTER_VOLUME_MAX}; clamping`,
    };
  }
  if (value < MASTER_VOLUME_MIN) {
    return {
      value: MASTER_VOLUME_MIN,
      warning: `[underscore-sdk] setMasterVolume(${value}) below floor ${MASTER_VOLUME_MIN}; clamping`,
    };
  }
  return { value, warning: null };
}

/**
 * Splice a single GainNode between the scsynth AudioWorklet and the
 * AudioContext destination so consumers can adjust output level at
 * the bus level without touching per-voice `amp`. Supersonic wires the
 * worklet directly to `destination` during its own init, so we
 * disconnect, then re-route `worklet -> masterGain -> destination`.
 * `gain.value` is initialized to `initialVolume` so a `setMasterVolume`
 * call made before init is honored once the graph exists.
 *
 * `workletNode` is a private Supersonic field that the SDK types in
 * its local d.ts. If Supersonic ever renames or drops that field the
 * SDK build breaks at this call site instead of silently shipping a
 * bypassed master bus. The runtime null-check warns when the field
 * does not exist at runtime so unexpected nulls (e.g. an older
 * supersonic build that has not populated it) are also visible.
 *
 * Returns the spliced GainNode, or `null` when the splice was skipped
 * (audio still plays via Supersonic's default wiring; setMasterVolume
 * becomes a no-op but caches values so a future Supersonic fix makes
 * them effective without consumer changes).
 */
export function spliceMasterGain(sonic: SuperSonic, initialVolume: number): GainNode | null {
  const ctx = sonic.audioContext;
  const workletNode = sonic.workletNode;
  if (!ctx || !workletNode) {
    console.warn(
      "[underscore-sdk] master GainNode splice skipped: " +
        "supersonic-scsynth did not expose audioContext/workletNode " +
        "after init(). Audio will play but setMasterVolume will be a no-op. " +
        "This usually means supersonic-scsynth changed its internal shape; " +
        "open an SDK issue with your supersonic-scsynth version."
    );
    return null;
  }
  const masterGain = ctx.createGain();
  masterGain.gain.value = initialVolume;
  try {
    workletNode.disconnect(ctx.destination);
  } catch {
    /*
     * Older Supersonic builds may already have failed the original
     * destination connect, or may have wired the worklet through a
     * different node. A best-effort disconnect followed by an
     * explicit re-connect is correct in either case; we never want a
     * routing exception to break engine init.
     */
  }
  workletNode.connect(masterGain);
  masterGain.connect(ctx.destination);
  return masterGain;
}
