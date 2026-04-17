/*
 * Generation live test.
 *
 * End-to-end: create a composition, kick off a real LLM generation, stream
 * progress via SSE, and assert the final `ready` event arrives.
 *
 * This suite is SLOW (30-120s) and COSTS LLM tokens per run. It is
 * opt-in: set UNDERSCORE_LIVE_GENERATION=1 to include it.
 *
 * Required env:
 *   UNDERSCORE_SECRET_KEY         -- `us_sec_...`
 *   UNDERSCORE_LIVE_GENERATION=1  -- explicit opt-in
 *
 * Optional env:
 *   UNDERSCORE_BASE_URL             (default http://localhost:3333)
 *   UNDERSCORE_TEST_COMPOSITION_ID  (reuse an existing composition instead
 *                                    of creating a new one per test run)
 */

import { describe, it, expect } from "vitest";
import { Underscore, type GenerationEvent } from "../../src/index.js";
import { loadLiveConfig, pingApi } from "./config.js";

const cfg = loadLiveConfig();

const skipReason = !cfg.runGeneration
  ? "UNDERSCORE_LIVE_GENERATION not set to 1"
  : !cfg.secretKey
    ? "UNDERSCORE_SECRET_KEY not set"
    : null;
if (skipReason) {
  console.warn(`[live:generation] skipping: ${skipReason}`);
}

describe.skipIf(skipReason !== null)("live: generation", () => {
  it("streams a generation from start to ready", async () => {
    if (!(await pingApi(cfg.baseUrl))) {
      throw new Error(`Cannot reach Underscore API at ${cfg.baseUrl}`);
    }

    const client = new Underscore({
      apiKey: cfg.secretKey!,
      baseUrl: cfg.baseUrl,
    });

    /*
     * Prefer an existing composition to keep test runs idempotent and
     * inexpensive (avoids creating a new composition row per run).
     * Fall back to creating one if the user didn't supply one.
     */
    let compositionId: string;
    if (cfg.compositionId) {
      compositionId = cfg.compositionId;
    } else {
      const created = await client.createComposition({
        title: `sdk-live-gen-${Date.now()}`,
        visibility: "unlisted",
      });
      compositionId = created.id;
    }

    // Kick off generation via the server-safe primitive so we exercise
    // the same code path a backend-proxy would run.
    const { jobId, streamUrl } = await client.startGeneration(
      compositionId,
      "short warm sine pad, stereo, 2 bars"
    );
    expect(jobId).toMatch(/^job_/);
    expect(streamUrl).toMatch(/^\/api\/stream\//);

    const events: GenerationEvent[] = [];
    let readySynthName: string | undefined;

    /*
     * Deliberately NOT passing compositionId: that overload triggers
     * browser-only auto-loading of the synth through supersonic-scsynth
     * (which needs `window`). For a Node-side test we only care about
     * the protocol, so we observe events and verify the synth exists via
     * the plain HTTP getSynth call below -- exactly what a backend
     * proxy would do before forwarding the streamUrl to a real browser.
     */
    for await (const event of client.subscribeToGeneration(streamUrl)) {
      events.push(event);
      if (event.type === "ready") {
        readySynthName = event.synthName;
        break;
      }
      if (event.type === "error") {
        throw new Error(`Generation failed: ${event.error}`);
      }
    }

    expect(events.length).toBeGreaterThan(0);
    expect(readySynthName).toBeTypeOf("string");

    // After `ready` we should be able to fetch the synth's metadata.
    const metadata = await client.getSynth(compositionId, readySynthName!);
    expect(metadata.name).toBe(readySynthName);
    expect(Array.isArray(metadata.params)).toBe(true);
  }, // Generous per-test timeout on top of the global one; if a real LLM
  // takes this long something is wrong and we want a clean failure.
  150_000);
});
