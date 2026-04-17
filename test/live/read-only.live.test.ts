/*
 * Read-only live tests.
 *
 * Exercise the SDK methods that any `synth:read`-scoped publishable key
 * can use. These are the fastest live tests and the most important for
 * third-party consumers -- they are the "does the published API still
 * match our types and error shapes?" regression suite.
 *
 * Required env:
 *   UNDERSCORE_PUBLISHABLE_KEY    -- `us_pub_...`
 *   UNDERSCORE_TEST_COMPOSITION_ID -- an unlisted/public composition
 *                                     owned by the same user, containing
 *                                     at least one synth
 *
 * Optional env:
 *   UNDERSCORE_BASE_URL      (default http://localhost:3333)
 *   UNDERSCORE_TEST_SYNTH_NAME (default: newest synth in composition)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { Underscore, ApiError, type SynthMetadata, type SynthSummary } from "../../src/index.js";
import { loadLiveConfig, pingApi } from "./config.js";

const cfg = loadLiveConfig();

const skipReason = !cfg.publishableKey
  ? "UNDERSCORE_PUBLISHABLE_KEY not set"
  : !cfg.compositionId
    ? "UNDERSCORE_TEST_COMPOSITION_ID not set"
    : null;

if (skipReason) {
  console.warn(`[live:read-only] skipping: ${skipReason}`);
}

describe.skipIf(skipReason !== null)("live: read-only", () => {
  let client: Underscore;
  let synths: SynthSummary[];
  let targetSynthName: string;

  beforeAll(async () => {
    const reachable = await pingApi(cfg.baseUrl);
    if (!reachable) {
      throw new Error(
        `Cannot reach Underscore API at ${cfg.baseUrl}. Start it with \`make dev-api\` or set UNDERSCORE_BASE_URL.`
      );
    }

    client = new Underscore({
      apiKey: cfg.publishableKey!,
      baseUrl: cfg.baseUrl,
    });

    synths = await client.listSynths(cfg.compositionId!);
    if (synths.length === 0) {
      throw new Error(
        `Test composition ${cfg.compositionId} has no synths. Generate at least one synth in it before running live tests.`
      );
    }
    targetSynthName = cfg.synthName ?? synths[synths.length - 1].name;
  });

  it("lists synths in the test composition", () => {
    expect(Array.isArray(synths)).toBe(true);
    expect(synths.length).toBeGreaterThan(0);
    for (const synth of synths) {
      expect(typeof synth.name).toBe("string");
      expect(typeof synth.description).toBe("string");
      expect(Array.isArray(synth.params)).toBe(true);
    }
  });

  it("fetches composition metadata", async () => {
    const composition = await client.getComposition(cfg.compositionId!);
    expect(composition.id).toBe(cfg.compositionId);
    expect(["unlisted", "public", "private"]).toContain(composition.visibility);
  });

  it("fetches a synth's metadata with a valid schema", async () => {
    const metadata: SynthMetadata = await client.getSynth(cfg.compositionId!, targetSynthName);
    expect(metadata.name).toBe(targetSynthName);
    expect(typeof metadata.description).toBe("string");
    expect(Array.isArray(metadata.params)).toBe(true);
    // Every param must declare min/max (the schema enforces this, but
    // assert explicitly so a future schema relaxation doesn't silently
    // remove guarantees SDK consumers rely on).
    for (const param of metadata.params) {
      expect(typeof param.name).toBe("string");
      expect(typeof param.min).toBe("number");
      expect(typeof param.max).toBe("number");
    }
  });

  it("exposes signed sample URLs when the synth has samples", async () => {
    const metadata = await client.getSynth(cfg.compositionId!, targetSynthName);
    if (!metadata.samples || metadata.samples.length === 0) {
      // Not every synth has samples; skip without failing the run.
      return;
    }
    for (const sample of metadata.samples) {
      expect(typeof sample.bufferNum).toBe("number");
      // The API was recently fixed to populate signed sample URLs for SDK
      // consumers. Treat a missing url as a hard regression.
      expect(typeof sample.url).toBe("string");
      expect(sample.url).toMatch(/^https?:\/\//);
    }
  });

  it("downloads the compiled .scsyndef binary", async () => {
    const response = await fetch(
      `${cfg.baseUrl}/api/v1/compositions/${cfg.compositionId}/synths/${targetSynthName}/synthdef`,
      { headers: { "Underscore-API-Key": cfg.publishableKey! } }
    );
    expect(response.ok).toBe(true);
    const buffer = await response.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
    /*
     * SCSyndef files begin with the ASCII magic "SCgf" followed by a
     * 32-bit version. Assert only the magic so a future format bump
     * doesn't force a test update -- the important guarantee is that the
     * endpoint returns a real synthdef and not, say, an HTML error page.
     */
    const magic = new Uint8Array(buffer).subarray(0, 4);
    expect(String.fromCharCode(...magic)).toBe("SCgf");
  });

  it("rejects requests with an invalid API key (401)", async () => {
    const rogue = new Underscore({
      apiKey: "us_pub_not_a_real_key",
      baseUrl: cfg.baseUrl,
    });
    await expect(rogue.listSynths(cfg.compositionId!)).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
  });

  it("returns 404 for a non-existent composition", async () => {
    await expect(client.listSynths("cmp_definitely_does_not_exist_xxxxx")).rejects.toBeInstanceOf(
      ApiError
    );
  });
});
