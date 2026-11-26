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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const setTargetAtTimeSpy = vi.fn();
const gains: FakeGainNode[] = [];

class FakeGainNode {
  gain = {
    value: 1,
    setTargetAtTime: setTargetAtTimeSpy,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  context = { currentTime: 2, state: "running" };
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext {
  destination = {} as AudioNode;
  state: AudioContextState = "running";
  createGain = (): FakeGainNode => {
    const node = new FakeGainNode();
    gains.push(node);
    return node;
  };
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
    gains.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("fades the playback bus to exact silence before teardown, without changing master volume", async () => {
    vi.useFakeTimers();
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    await engine.init();
    engine.setMasterVolume(0.7);
    const gate = gains[1];
    gate.gain.value = 0.6;
    let finished = false;
    const fading = engine.fadeOut().then(() => {
      finished = true;
    });
    expect(gate.gain.setValueAtTime).toHaveBeenLastCalledWith(0.6, 2);
    expect(gate.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 2.02);
    await vi.advanceTimersByTimeAsync(19);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(6);
    await fading;
    expect(finished).toBe(true);
    engine.fadeIn();
    expect(gate.gain.cancelScheduledValues).toHaveBeenLastCalledWith(2);
    expect(gate.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 2.02);
    expect(engine.getMasterVolume()).toBe(0.7);
  });

  it("silences a suspended context without waiting for its frozen audio clock", async () => {
    vi.useFakeTimers();
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    await engine.init();
    const gate = gains[1];
    gate.context.state = "suspended";
    await engine.fadeOut();
    expect(gate.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 2);
    expect(gate.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
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
