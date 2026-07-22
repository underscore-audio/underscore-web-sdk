/**
 * Regression tests for `AudioEngine.loadSampleFromData`.
 *
 * Sibling to audio.load-synthdef.test.ts: sample bytes used to be
 * wrapped in a Blob + object URL before reaching the engine. Since
 * supersonic 0.70 accepts ArrayBuffer natively, the contract is
 * direct byte passthrough -- same judo as the synthdef path.
 *
 * Lives in its own file because the supersonic-scsynth mock is
 * module-wide and must not leak into audio.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const loadSampleSpy = vi.fn(async (_bufferNum: number, _source: ArrayBuffer | string) => {});
const syncSpy = vi.fn(async () => {});

vi.mock("supersonic-scsynth", () => ({
  SuperSonic: class {
    audioContext = { state: "running" };
    async init(): Promise<void> {}
    async shutdown(): Promise<void> {}
    loadSample = loadSampleSpy;
    sync = syncSpy;
  },
}));

import { AudioEngine } from "./audio.js";

describe("AudioEngine.loadSampleFromData", () => {
  beforeEach(() => {
    loadSampleSpy.mockClear();
    syncSpy.mockClear();
  });

  it("passes the ArrayBuffer straight through, not a URL string", async () => {
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF" magic
    await engine.loadSampleFromData(0, bytes.buffer);

    expect(loadSampleSpy).toHaveBeenCalledOnce();
    const [bufferNum, source] = loadSampleSpy.mock.calls[0];
    expect(bufferNum).toBe(0);
    expect(source).toBe(bytes.buffer);
  });

  it("never calls URL.createObjectURL (no blob fallback)", async () => {
    const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL");
    try {
      const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
      const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      await engine.loadSampleFromData(3, bytes.buffer);

      expect(createObjectUrlSpy).not.toHaveBeenCalled();
      expect(syncSpy).toHaveBeenCalledOnce();
    } finally {
      createObjectUrlSpy.mockRestore();
    }
  });
});
