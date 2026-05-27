/**
 * Regression test for `AudioEngine.loadSynthdefFromData`.
 *
 * The engine used to wrap synthdef bytes in a `Blob` and pass the
 * resulting `blob:` URL to the underlying audio backend. That broke
 * the moment the backend started probing resources with a `HEAD`
 * request before fetching them: Chromium rejects HEAD on `blob:`
 * URLs with `ERR_METHOD_NOT_SUPPORTED`, so every synthdef load
 * silently failed and downstream `synth.play()` calls produced no
 * sound. The fix is to encode synthdef bytes as a `data:` URL,
 * which supports HEAD and does not need revocation.
 *
 * Lives in its own file for the same reason as audio.init-watchdog.test.ts:
 * the supersonic-scsynth mock is module-wide and must not leak into
 * audio.test.ts, which exercises pre-init paths that should never
 * instantiate the real engine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const loadSynthDefSpy = vi.fn(async (_url: string) => {});

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

  it("passes a data: URL, not a blob: URL", async () => {
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    const bytes = new Uint8Array([0x53, 0x43, 0x67, 0x66]); // "SCgf" magic
    await engine.loadSynthdefFromData(bytes.buffer);

    expect(loadSynthDefSpy).toHaveBeenCalledOnce();
    const url = loadSynthDefSpy.mock.calls[0][0];
    expect(url).toMatch(/^data:application\/octet-stream;base64,/);
    expect(url).not.toMatch(/^blob:/);
  });

  it("base64-encodes the binary payload faithfully", async () => {
    const engine = new AudioEngine({ wasmBaseUrl: "/supersonic/" });
    const bytes = new Uint8Array([0x00, 0x01, 0xff, 0x7f, 0x80]);
    await engine.loadSynthdefFromData(bytes.buffer);

    const url = loadSynthDefSpy.mock.calls[0][0];
    const base64 = url.replace(/^data:[^,]+,/, "");
    const decoded = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("never calls URL.createObjectURL (no blob fallback)", async () => {
    /*
     * Pin the failure mode that motivated the data: URL switch. If a
     * future change reintroduces a Blob/createObjectURL path -- even
     * as a "fallback" -- Chromium will reject the backend's HEAD
     * probe with ERR_METHOD_NOT_SUPPORTED and audio will go silent.
     * Asserting this at the syscall boundary is the only way to
     * catch that regression without wiring up a real browser.
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
