/**
 * Smoothing-path coverage for `AudioEngine.setMasterVolume`.
 *
 * `setMasterVolume` is documented to apply gain changes via
 * `setTargetAtTime` so a UI slider drag becomes a continuous amplitude
 * curve rather than a series of discrete steps. A bare assignment to
 * `gain.value` would zipper-noise on rapid moves; that contract has no
 * other coverage and is exactly the kind of audible regression a
 * supersonic-scsynth minor bump or a refactor could silently introduce.
 *
 * Lives in its own file because it relies on a module-wide mock of
 * `supersonic-scsynth` that simulates a fully-initialised engine
 * (node + audioContext present), which would conflict with the
 * pre-init paths exercised in `audio.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const setTargetAtTimeSpy = vi.fn();

class FakeGainNode {
  gain = {
    value: 1,
    setTargetAtTime: setTargetAtTimeSpy,
  };
  context = { currentTime: 0 };
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext {
  destination = {} as AudioNode;
  state: AudioContextState = "running";
  createGain = (): FakeGainNode => new FakeGainNode();
}

class FakeEngineNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

vi.mock("supersonic-scsynth", () => ({
  SuperSonic: class {
    audioContext: FakeAudioContext = new FakeAudioContext();
    node: FakeEngineNode = new FakeEngineNode();
    init(): Promise<void> {
      return Promise.resolve();
    }
    shutdown = vi.fn(async () => {});
  },
}));

import { AudioEngine } from "./audio.js";

describe("AudioEngine.setMasterVolume smoothing", () => {
  beforeEach(() => {
    setTargetAtTimeSpy.mockClear();
  });

  it("schedules a setTargetAtTime ramp instead of a hard gain assignment after init", async () => {
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    await engine.init();

    engine.setMasterVolume(0.7);

    expect(setTargetAtTimeSpy).toHaveBeenCalledTimes(1);
    /*
     * The contract is: target value first, currentTime second, smoothing
     * tau third. Asserting on the smoothing tau pins the no-zipper
     * behavior -- a regression to `gain.value = x` would never reach
     * setTargetAtTime, and a regression to a stepwise schedule would
     * pass a different (or zero) tau.
     */
    const [target, when, tau] = setTargetAtTimeSpy.mock.calls[0];
    expect(target).toBe(0.7);
    expect(typeof when).toBe("number");
    expect(tau).toBeGreaterThan(0);
    expect(tau).toBeLessThan(0.1);
  });

  it("clamps above-ceiling input before scheduling the ramp", async () => {
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    await engine.init();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      engine.setMasterVolume(5);
      const [target] = setTargetAtTimeSpy.mock.calls[0];
      expect(target).toBe(2);
      expect(engine.getMasterVolume()).toBe(2);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
