import { afterEach, describe, expect, it, vi } from "vitest";

const boot = vi.hoisted(() => ({
  starts: 0,
  resolve: null as (() => void) | null,
  reject: null as ((error: Error) => void) | null,
}));
vi.mock("supersonic-scsynth", () => ({
  SuperSonic: class {
    audioContext = null;
    node = null;
    init(): Promise<void> {
      ++boot.starts;
      return new Promise((resolve, reject) => {
        boot.resolve = resolve;
        boot.reject = reject;
      });
    }
    shutdown(): Promise<void> {
      return Promise.resolve();
    }
  },
}));
import { AudioEngine } from "./audio.js";

afterEach(() => {
  boot.starts = 0;
  boot.resolve = null;
  boot.reject = null;
});

describe("audio initialization ownership", () => {
  it("keeps concurrent callers pending until the underlying engine is ready", async () => {
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    const first = engine.init();
    await vi.waitFor(() => expect(boot.resolve).not.toBeNull());
    let resolved = false;
    const second = engine.init().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(engine.isInitialized()).toBe(false);
    if (!boot.resolve) throw new Error("Initialization did not start");
    boot.resolve();
    await Promise.all([first, second]);
    expect(resolved).toBe(true);
    expect(engine.isInitialized()).toBe(true);
    expect(boot.starts).toBe(1);
  });

  it("starts a fresh retry after engine initialization fails", async () => {
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    const first = engine.init();
    await vi.waitFor(() => expect(boot.reject).not.toBeNull());
    if (!boot.reject) throw new Error("Initialization did not start");
    boot.reject(new Error("Engine boot failed"));
    await expect(first).rejects.toThrow("Engine boot failed");
    expect(engine.isInitialized()).toBe(false);
    boot.resolve = null;
    const retry = engine.init();
    await vi.waitFor(() => expect(boot.resolve).not.toBeNull());
    if (!boot.resolve) throw new Error("Retry did not start");
    boot.resolve();
    await retry;
    expect(engine.isInitialized()).toBe(true);
    expect(boot.starts).toBe(2);
  });
});
