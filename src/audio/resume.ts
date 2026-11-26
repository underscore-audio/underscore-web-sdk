import { AudioError } from "../errors.js";

function running(context: AudioContext): boolean {
  return context.state === "running";
}

/** A suspended context can hang outside a gesture; keep that failure retryable. */
export async function resumeAudioContext(
  context: AudioContext | null,
  timeoutMs = 2000
): Promise<void> {
  if (!context || running(context)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.resume(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new AudioError("Audio is blocked. Tap Play again to enable sound.")),
          timeoutMs
        );
      }),
    ]);
    if (!running(context))
      throw new AudioError("Audio is blocked. Tap Play again to enable sound.");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
