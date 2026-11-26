import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeAudioContext } from "./resume.js";

afterEach(() => vi.useRealTimers());

describe("audio resume", () => {
  it("rejects a hung resume and allows a later gesture to retry", async () => {
    vi.useFakeTimers();
    const context = { state: "suspended", resume: vi.fn(() => new Promise<void>(() => {})) };
    const attempt = resumeAudioContext(context as unknown as AudioContext, 100);
    const assertion = expect(attempt).rejects.toThrow("Tap Play again");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    context.resume.mockImplementationOnce(async () => {
      context.state = "running";
    });
    await expect(
      resumeAudioContext(context as unknown as AudioContext, 100)
    ).resolves.toBeUndefined();
  });

  it("does not treat a resolved-but-still-suspended context as unlocked", async () => {
    const context = { state: "suspended", resume: vi.fn().mockResolvedValue(undefined) };
    await expect(resumeAudioContext(context as unknown as AudioContext)).rejects.toThrow(
      "Audio is blocked"
    );
  });
});
