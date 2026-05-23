/**
 * Watchdog behavior for AudioEngine.init().
 *
 * The hung-init failure mode (supersonic-scsynth waiting for
 * AudioContext.getOutputTimestamp().contextTime > 0 with no timeout while
 * the context is suspended) used to surface as zero logs, zero errors, and
 * a permanently pending init promise. That is unrecoverable from the
 * consumer side. These tests pin the contract that init() now rejects with
 * a clear, gesture-pointing AudioError when the underlying engine fails to
 * complete, and that init state is cleared so a retry from inside a real
 * user-gesture handler starts fresh.
 *
 * Lives in its own file because the supersonic-scsynth mock is module-wide
 * and must not bleed into audio.test.ts, which exercises pre-init paths
 * that legitimately never import the real engine module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const shutdownSpy = vi.fn(async () => {});

vi.mock("supersonic-scsynth", () => ({
  SuperSonic: class {
    audioContext = null;
    init(): Promise<void> {
      return new Promise(() => {
        /* never resolves -- simulates suspended AudioContext */
      });
    }
    shutdown = shutdownSpy;
  },
}));

import { AudioEngine } from "./audio.js";
import { AudioError } from "./errors.js";

describe("AudioEngine.init() watchdog", () => {
  /*
   * Real timers + a small initTimeoutMs keep the test honest -- it
   * exercises the same setTimeout / Promise.race the production path
   * uses, just with a 25 ms ceiling instead of 10 s. Fake timers would
   * skip the actual race and miss any regression in the cleanup path.
   */
  const TEST_TIMEOUT_MS = 25;

  beforeEach(() => {
    shutdownSpy.mockClear();
  });

  it("rejects with an AudioError after the watchdog expires", async () => {
    const engine = new AudioEngine({
      wasmBaseUrl: "/supersonic/",
      initTimeoutMs: TEST_TIMEOUT_MS,
    });
    await expect(engine.init()).rejects.toBeInstanceOf(AudioError);
  });

  it("includes a user-gesture hint in the rejection message", async () => {
    const engine = new AudioEngine({
      wasmBaseUrl: "/supersonic/",
      initTimeoutMs: TEST_TIMEOUT_MS,
    });
    await expect(engine.init()).rejects.toMatchObject({
      message: expect.stringContaining("user gesture"),
    });
  });

  it("releases the partial supersonic instance on timeout", async () => {
    const engine = new AudioEngine({
      wasmBaseUrl: "/supersonic/",
      initTimeoutMs: TEST_TIMEOUT_MS,
    });
    await expect(engine.init()).rejects.toBeInstanceOf(AudioError);
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(engine.isInitialized()).toBe(false);
  });

  it("clears init state so the next init() retries instead of returning the failed promise", async () => {
    const engine = new AudioEngine({
      wasmBaseUrl: "/supersonic/",
      initTimeoutMs: TEST_TIMEOUT_MS,
    });

    const first = engine.init();
    await expect(first).rejects.toBeInstanceOf(AudioError);

    /*
     * Without the clear, retrying would return the already-rejected
     * promise (or, worse, a never-resolving cached one). The contract is
     * that a fresh init() attempt -- e.g. the first one made from inside
     * a real click handler -- starts from a clean slate.
     */
    const second = engine.init();
    expect(second).not.toBe(first);
    await expect(second).rejects.toBeInstanceOf(AudioError);
    expect(shutdownSpy).toHaveBeenCalledTimes(2);
  });
});
