/**
 * Late-resolve race coverage for AudioEngine.init() watchdog.
 *
 * The watchdog rejects after `initTimeoutMs` even if the underlying
 * supersonic-scsynth init() is still pending. That alone is not enough:
 * supersonic's init() may eventually resolve (some browsers do release
 * the suspended AudioContext after the user finally provides a gesture,
 * or a slow WASM fetch may finally land), and on that late resolve the
 * SDK's doInit() resumes from inside an already-detached attempt. If
 * doInit then dereferences `this.sonic` for the master-bus splice, it
 * touches the field the watchdog catch arm nulled out and raises an
 * unhandled rejection -- exactly the kind of half-initialized hangover
 * the watchdog was supposed to eliminate.
 *
 * Lives in its own file because the supersonic-scsynth mock here uses a
 * caller-controlled deferred to deterministically order timeout against
 * init resolution. Mixing that into the always-pending mock in
 * audio.init-watchdog.test.ts would force every other test in that file
 * to opt out of the deferred.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let initResolver: (() => void) | null = null;
const shutdownSpy = vi.fn(async () => {});

/*
 * The fake instance must carry audioContext + workletNode so the
 * late-resolve branch reaches the splice point (the bug surface) if the
 * attempt-token bailout regresses. Without these fields, a regressed
 * doInit would just spliceMasterGain-noop instead of dereferencing a
 * stale `this.sonic` and the race coverage would be silent.
 */
class FakeGain {
  gain = { value: 1, setTargetAtTime: vi.fn() };
  context = { currentTime: 0 };
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeWorklet {
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeAudioContext {
  destination = {} as AudioNode;
  state: AudioContextState = "running";
  createGain = (): FakeGain => new FakeGain();
}

vi.mock("supersonic-scsynth", () => ({
  SuperSonic: class {
    audioContext: FakeAudioContext = new FakeAudioContext();
    workletNode: FakeWorklet = new FakeWorklet();
    init(): Promise<void> {
      return new Promise<void>((resolve) => {
        initResolver = resolve;
      });
    }
    shutdown = shutdownSpy;
  },
}));

import { AudioEngine } from "./audio.js";
import { AudioError } from "./errors.js";

describe("AudioEngine.init() watchdog late-resolve race", () => {
  const TEST_TIMEOUT_MS = 25;

  beforeEach(() => {
    initResolver = null;
    shutdownSpy.mockClear();
  });

  it("ignores a doInit() that resolves after the watchdog has already rejected", async () => {
    const engine = new AudioEngine({
      wasmBaseUrl: "/supersonic/",
      initTimeoutMs: TEST_TIMEOUT_MS,
    });

    /*
     * Catch the unhandledRejection event globally for the duration of
     * this test. Before the attempt-token fix, the late doInit() would
     * dereference `this.sonic` (now nulled by the catch arm) and raise
     * a TypeError as an unhandled rejection; with the fix in place no
     * such rejection should appear.
     */
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown): void => {
      unhandled.push(err);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const initPromise = engine.init();
      await expect(initPromise).rejects.toBeInstanceOf(AudioError);

      /*
       * The watchdog has now rejected; the SuperSonic instance is
       * detached (`this.sonic === null`) but the original init()
       * promise is still pending. Resolve it deliberately to walk the
       * doInit() resume path through the post-await splice point.
       */
      expect(initResolver).not.toBeNull();
      initResolver!();

      /*
       * Give the microtask queue room to drain the late resume and any
       * follow-on unhandled rejection a regression would produce.
       * setTimeout(0) is more than enough because the resume is purely
       * synchronous after the resolved init -- two microtask hops at
       * most.
       */
      await new Promise<void>((r) => setTimeout(r, 10));

      expect(unhandled).toEqual([]);
      expect(engine.isInitialized()).toBe(false);
      /*
       * Two shutdowns: one from the watchdog catch arm at timeout, one
       * from the late doInit bailout draining any state supersonic
       * allocated during the resolve that completed after the catch
       * already ran. Both are best-effort and idempotent.
       */
      expect(shutdownSpy).toHaveBeenCalledTimes(2);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
