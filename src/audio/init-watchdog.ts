/**
 * Init watchdog: timeout policy + race-timer builder.
 *
 * The audio engine guards `init()` with a watchdog because
 * supersonic-scsynth's underlying init waits for the AudioContext's
 * `contextTime` to advance, which requires a user gesture under every
 * browser's autoplay policy. Without this watchdog, calling `init()`
 * before a gesture leaves the SDK in a permanent pending state with
 * no error and no recovery path.
 *
 * Lives in its own file so the constant and the timeout-promise
 * construction can be tested without spinning the rest of the engine
 * up, and so the rejection message (which is the contract surface
 * consumers actually read in their console) is right next to the
 * value the watchdog uses.
 */

import { AudioError } from "../errors.js";

/*
 * 10 s comfortably absorbs a slow WASM fetch while still failing
 * loudly when the autoplay policy is the blocker. Anything shorter
 * makes a slow first-load flake; anything longer hides the gesture
 * misconfiguration that is the typical cause of the hang.
 */
export const INIT_TIMEOUT_MS = 10_000;

export interface InitTimeout {
  /** Rejects with an `AudioError` after `timeoutMs`. */
  timeoutPromise: Promise<never>;
  /** Cancels the underlying setTimeout. Safe to call multiple times. */
  cancel: () => void;
}

/**
 * Build a rejecting promise + a canceller for the init watchdog race.
 *
 * Separated from the engine method because the timer cleanup (the
 * `cancel()` is what the engine's `finally` arm calls so a winning
 * `doInit()` does not leak the pending setTimeout) is exactly the
 * kind of detail that gets quietly broken when extraction happens
 * later -- pulling it out now and unit-testing it pins the contract.
 */
export function createInitTimeout(timeoutMs: number): InitTimeout {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new AudioError(
          `Audio engine init() did not complete within ${timeoutMs}ms. ` +
            `This usually means the AudioContext is still suspended -- ` +
            `browser autoplay policy requires init() to be called from a ` +
            `user gesture handler (click, tap, keydown).`
        )
      );
    }, timeoutMs);
  });
  return {
    timeoutPromise,
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
