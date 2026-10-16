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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  // Let the mocked module load before expiring the watchdog. Otherwise
  // worker scheduling can time out resource delivery before an instance
  // exists, which does not exercise partial-engine cleanup.
  const TEST_TIMEOUT_MS = 25;

  beforeEach(() => {
    vi.useFakeTimers();
    shutdownSpy.mockClear();
  });

  afterEach(() => vi.useRealTimers());

  async function expectTimeout(pending: Promise<void>): Promise<void> {
    const rejected = expect(pending).rejects.toBeInstanceOf(AudioError);
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(TEST_TIMEOUT_MS);
    await rejected;
  }

  it("rejects with an AudioError after the watchdog expires", async () => {
    const engine = new AudioEngine({
      wasmBaseUrl: "/supersonic/",
      initTimeoutMs: TEST_TIMEOUT_MS,
    });
    await expectTimeout(engine.init());
  });

  it("includes a user-gesture hint in the rejection message", async () => {
    const engine = new AudioEngine({
      wasmBaseUrl: "/supersonic/",
      initTimeoutMs: TEST_TIMEOUT_MS,
    });
    const pending = engine.init();
    const message = expect(pending).rejects.toMatchObject({
      message: expect.stringContaining("user gesture"),
    });
    await expectTimeout(pending);
    await message;
  });

  it("releases the partial supersonic instance on timeout", async () => {
    const engine = new AudioEngine({
      wasmBaseUrl: "/supersonic/",
      initTimeoutMs: TEST_TIMEOUT_MS,
    });
    await expectTimeout(engine.init());
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
    expect(engine.isInitialized()).toBe(false);
  });

  it("clears init state so the next init() retries instead of returning the failed promise", async () => {
    const engine = new AudioEngine({
      wasmBaseUrl: "/supersonic/",
      initTimeoutMs: TEST_TIMEOUT_MS,
    });

    const first = engine.init();
    await expectTimeout(first);

    /*
     * Without the clear, retrying would return the already-rejected
     * promise (or, worse, a never-resolving cached one). The contract is
     * that a fresh init() attempt -- e.g. the first one made from inside
     * a real click handler -- starts from a clean slate.
     */
    const second = engine.init();
    expect(second).not.toBe(first);
    await expectTimeout(second);
    expect(shutdownSpy).toHaveBeenCalledTimes(2);
  });
});
