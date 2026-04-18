/**
 * Backend proxy for secure generation.
 *
 * Holds the Underscore secret key (never leaves the server) and exposes a
 * minimal endpoint the browser can call. For a real app you'd add
 * authentication, rate-limiting, and whatever composition/user
 * authorization your product requires.
 */

import express from "express";
import cors from "cors";
import { Underscore } from "@underscore-audio/sdk";

const PORT = Number(process.env.PORT ?? 8787);
const SECRET_KEY = process.env.UNDERSCORE_SECRET_KEY;
const HOST = process.env.UNDERSCORE_HOST ?? "https://underscore.audio";

if (!SECRET_KEY) {
  console.error(
    "UNDERSCORE_SECRET_KEY is required. Get a secret key at https://underscore.audio/settings."
  );
  process.exit(1);
}

const underscore = new Underscore({
  apiKey: SECRET_KEY,
  baseUrl: HOST,
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

app.post("/proxy/generate", async (req, res) => {
  const { compositionId, description } = req.body ?? {};

  if (typeof compositionId !== "string" || typeof description !== "string") {
    return res.status(400).json({
      error: "compositionId and description (strings) are required",
    });
  }

  try {
    const { jobId, streamUrl } = await underscore.startGeneration(compositionId, description);

    /*
     * Return both the streamUrl (relative) and the host, so the browser
     * can build the absolute URL for EventSource without needing to know
     * the Underscore host directly.
     */
    res.json({ jobId, streamUrl, host: HOST });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Failed to start generation";
    res.status(status).json({ error: message });
  }
});

app.get("/proxy/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`[proxy] listening on http://localhost:${PORT}`);
  console.log(`[proxy] forwarding to ${HOST}`);
});
