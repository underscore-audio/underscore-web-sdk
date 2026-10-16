import { afterEach, describe, expect, it, vi } from "vitest";

const boot = vi.hoisted(() => ({
  ready: null as (() => void) | null,
  resourcesReady: null as (() => void) | null,
  context: null as AudioContext | null,
  shutdown: vi.fn(async () => {}),
}));
vi.mock("supersonic-scsynth", () => ({
  SuperSonic: class {
    audioContext: AudioContext | null;
    node = null;
    constructor(options: { audioContext?: AudioContext }) {
      this.audioContext = options.audioContext ?? null;
      boot.context = this.audioContext;
    }
    on(_event: string, listener: (data: { type: string }) => void): () => void {
      boot.resourcesReady = () => listener({ type: "wasm" });
      return () => {
        boot.resourcesReady = null;
      };
    }
    init(): Promise<void> {
      return new Promise((resolve) => {
        boot.ready = resolve;
      });
    }
    shutdown = boot.shutdown;
  },
}));
import { AudioEngine } from "./audio.js";

class GestureContext {
  state = "suspended";
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  boot.ready = null;
  boot.resourcesReady = null;
  boot.context = null;
  boot.shutdown.mockReset().mockResolvedValue(undefined);
});

function start(): { engine: AudioEngine; pending: Promise<void> } {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", GestureContext);
  const engine = new AudioEngine({ wasmBaseUrl: "/audio/" });
  return { engine, pending: engine.init() };
}

async function bootStarted(): Promise<void> {
  await vi.waitFor(() => expect(boot.ready).not.toBeNull());
}

describe("audio initialization phases", () => {
  it("does not report initialized until context resume and engine boot both finish", async () => {
    vi.useFakeTimers();
    let finishResume: (() => void) | undefined;
    class DelayedContext extends GestureContext {
      resume = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishResume = () => {
              this.state = "running";
              resolve();
            };
          })
      );
    }
    vi.stubGlobal("AudioContext", DelayedContext);
    const engine = new AudioEngine({ wasmBaseUrl: "/audio/" });
    const pending = engine.init();
    await bootStarted();
    boot.ready?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.isInitialized()).toBe(false);
    finishResume?.();
    await pending;
    expect(engine.isInitialized()).toBe(true);
  });

  it("unlocks the context synchronously and allows resource delivery beyond the boot deadline", async () => {
    const { engine, pending } = start();
    const context = engine.audioContext;
    expect(context?.resume).toHaveBeenCalledOnce();
    expect(context?.state).toBe("running");
    let failure: unknown;
    const observed = pending.catch((error: unknown) => {
      failure = error;
    });
    await bootStarted();
    expect(boot.context).toBe(context);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(failure).toBeUndefined();
    expect(boot.shutdown).not.toHaveBeenCalled();
    boot.resourcesReady?.();
    boot.ready?.();
    await observed;
    expect(engine.isInitialized()).toBe(true);
    expect(context?.close).not.toHaveBeenCalled();
  });

  it("bounds stalled resource delivery and releases its unlocked context", async () => {
    const { engine, pending } = start();
    const context = engine.audioContext;
    const rejected = expect(pending).rejects.toThrow("30000ms");
    await bootStarted();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(engine.isInitialized()).toBe(false);
    expect(engine.audioContext).toBeNull();
    expect(context?.state).toBe("closed");
    expect(boot.shutdown).toHaveBeenCalledOnce();
  });

  it("retains the shorter engine deadline after resources arrive and ignores late completion", async () => {
    const { engine, pending } = start();
    const rejected = expect(pending).rejects.toThrow("10000ms");
    await bootStarted();
    boot.resourcesReady?.();
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    boot.ready?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.isInitialized()).toBe(false);
    expect(engine.audioContext).toBeNull();
    expect(boot.shutdown).toHaveBeenCalledTimes(2);
  });

  it("rejects on time and permits a fresh boot even when failed-engine cleanup stalls", async () => {
    boot.shutdown.mockImplementation(() => new Promise(() => {}));
    const { engine, pending } = start();
    const context = engine.audioContext;
    let failure: unknown;
    const observed = pending.catch((error: unknown) => {
      failure = error;
    });
    await bootStarted();
    boot.resourcesReady?.();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(failure).toBeInstanceOf(Error);
    expect(context?.close).toHaveBeenCalledOnce();
    expect(engine.audioContext).toBeNull();
    await observed;

    const finishOldBoot = boot.ready;
    boot.ready = null;
    const retry = engine.init();
    await bootStarted();
    boot.ready?.();
    await retry;
    expect(engine.isInitialized()).toBe(true);
    expect(engine.audioContext).not.toBe(context);
    finishOldBoot?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.isInitialized()).toBe(true);
    expect(engine.audioContext?.state).toBe("running");
  });

  it("rejects on time even when closing the failed audio context never settles", async () => {
    const { engine, pending } = start();
    vi.mocked(engine.audioContext!.close).mockImplementation(() => new Promise(() => {}));
    let failure: unknown;
    const observed = pending.catch((error: unknown) => {
      failure = error;
    });
    await bootStarted();
    boot.resourcesReady?.();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(failure).toBeInstanceOf(Error);
    expect(engine.audioContext).toBeNull();
    await observed;
  });
});
