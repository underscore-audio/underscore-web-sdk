import { expect, it, vi } from "vitest";

const moduleLoad = vi.hoisted(() => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, pending, starts: 0 };
});
vi.mock("supersonic-scsynth", async () => {
  await moduleLoad.pending;
  return {
    SuperSonic: class {
      constructor() {
        ++moduleLoad.starts;
      }
    },
  };
});
import { AudioEngine } from "./audio.js";

it("does not attach an engine when its module arrives after initialization was abandoned", async () => {
  const engine = new AudioEngine({ wasmBaseUrl: "/audio/", initTimeoutMs: 25 });
  await expect(engine.init()).rejects.toThrow("25ms");
  moduleLoad.release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(moduleLoad.starts).toBe(0);
  expect(engine.engine).toBeNull();
  expect(engine.isInitialized()).toBe(false);
});
