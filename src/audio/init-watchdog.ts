/**
 * Init watchdog: timeout policy + race-timer builder.
 *
 * After resource delivery, supersonic-scsynth init waits for the AudioContext's
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

/** Resource delivery has its own bounded budget, independent of engine boot. */
export const RESOURCE_TIMEOUT_MS = 30_000;
export const INIT_TIMEOUT_MS = 10_000;

export interface InitTimeout {
  /** Rejects with an `AudioError` after `timeoutMs`. */
  timeoutPromise: Promise<never>;
  /** Cancels the underlying setTimeout. Safe to call multiple times. */
  cancel: () => void;
  /** Start a fresh deadline when initialization moves to the next phase. */
  restart: (timeoutMs: number) => void;
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
  let rejectTimeout: (error: AudioError) => void;
  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const restart = (deadlineMs: number): void => {
    cancel();
    timer = setTimeout(() => {
      rejectTimeout(
        new AudioError(
          `Audio initialization did not complete within ${deadlineMs}ms. ` +
            `Check the connection and retry from a user gesture handler (click, tap, keydown).`
        )
      );
    }, deadlineMs);
  };
  restart(timeoutMs);
  return { timeoutPromise, cancel, restart };
}
