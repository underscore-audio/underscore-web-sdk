/**
 * Regression tests for `AudioEngine.loadSynthdefFromData`.
 *
 * Synthdef bytes have historically been smuggled to the engine through
 * URL indirection, and it broke twice: `blob:` URLs were rejected by
 * the engine's `HEAD` probe (Chromium returns ERR_METHOD_NOT_SUPPORTED
 * for HEAD on blob:), and the `data:` URL replacement carried base64
 * overhead plus the same probe assumptions. Since supersonic 0.70,
 * `loadSynthDef` accepts an ArrayBuffer as a first-class input, so the
 * contract pinned here is direct byte passthrough: no blob:, no data:,
 * no `URL.createObjectURL`.
 *
 * Lives in its own file for the same reason as audio.init-watchdog.test.ts:
 * the supersonic-scsynth mock is module-wide and must not leak into
 * audio.test.ts, which exercises pre-init paths that should never
 * instantiate the real engine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const loadSynthDefSpy = vi.fn(async (_source: ArrayBuffer | string) => {});

vi.mock("supersonic-scsynth", () => ({
  SuperSonic: class {
    audioContext = { state: "running" };
    async init(): Promise<void> {}
    async shutdown(): Promise<void> {}
    loadSynthDef = loadSynthDefSpy;
  },
}));

import { AudioEngine } from "./audio.js";

describe("AudioEngine.loadSynthdefFromData", () => {
  beforeEach(() => {
    loadSynthDefSpy.mockClear();
  });

  it("passes the ArrayBuffer straight through, not a URL string", async () => {
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    const bytes = new Uint8Array([0x53, 0x43, 0x67, 0x66]); // "SCgf" magic
    await engine.loadSynthdefFromData(bytes.buffer);

    expect(loadSynthDefSpy).toHaveBeenCalledOnce();
    const source = loadSynthDefSpy.mock.calls[0][0];
    expect(source).toBe(bytes.buffer);
  });

  it("preserves the binary payload byte-for-byte", async () => {
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    const bytes = new Uint8Array([0x00, 0x01, 0xff, 0x7f, 0x80]);
    await engine.loadSynthdefFromData(bytes.buffer);

    const source = loadSynthDefSpy.mock.calls[0][0] as ArrayBuffer;
    expect(Array.from(new Uint8Array(source))).toEqual(Array.from(bytes));
  });

  it("never calls URL.createObjectURL (no blob fallback)", async () => {
    /*
     * Pin the failure mode that motivated moving off URL indirection.
     * If a future change reintroduces a Blob/createObjectURL path --
     * even as a "fallback" -- an engine HEAD probe will reject it and
     * audio will go silent. Asserting this at the syscall boundary is
     * the only way to catch that regression without wiring up a real
     * browser.
     */
    const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL");
    try {
      const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
      const bytes = new Uint8Array([0x53, 0x43, 0x67, 0x66, 0x01, 0x02, 0x03]);
      await engine.loadSynthdefFromData(bytes.buffer);

      expect(createObjectUrlSpy).not.toHaveBeenCalled();
    } finally {
      createObjectUrlSpy.mockRestore();
    }
  });
});
