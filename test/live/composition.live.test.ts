/*
 * Composition-create live tests.
 *
 * Verifies that a secret key (`us_sec_...`) can create compositions
 * against a real API, and that a publishable key is correctly rejected
 * by the server. These are write operations but cheap: no LLM is
 * invoked, no background job is enqueued.
 *
 * Required env:
 *   UNDERSCORE_SECRET_KEY     -- `us_sec_...`
 *
 * Optional env:
 *   UNDERSCORE_BASE_URL          (default http://localhost:3333)
 *   UNDERSCORE_PUBLISHABLE_KEY   (used only for the negative case if present)
 */

import { describe, it, expect } from "vitest";
import { Underscore, ApiError } from "../../src/index.js";
import { loadLiveConfig, pingApi } from "./config.js";

const cfg = loadLiveConfig();

const skipReason = !cfg.secretKey ? "UNDERSCORE_SECRET_KEY not set" : null;
if (skipReason) {
  console.warn(`[live:composition] skipping: ${skipReason}`);
}

describe.skipIf(skipReason !== null)("live: composition create", () => {
  it("creates a composition with the secret key", async () => {
    if (!(await pingApi(cfg.baseUrl))) {
      throw new Error(`Cannot reach Underscore API at ${cfg.baseUrl}`);
    }

    const client = new Underscore({
      apiKey: cfg.secretKey!,
      baseUrl: cfg.baseUrl,
    });

    const result = await client.createComposition({
      title: `sdk-live-test-${Date.now()}`,
      visibility: "unlisted",
    });

    expect(result.id).toMatch(/^cmp_/);
    expect(result.visibility).toBe("unlisted");
  });

  it.skipIf(!cfg.publishableKey)(
    "rejects composition creation with a publishable key (403)",
    async () => {
      const client = new Underscore({
        apiKey: cfg.publishableKey!,
        baseUrl: cfg.baseUrl,
      });

      /*
       * Assert on both the prototype chain (so `instanceof ApiError`
       * keeps working for SDK consumers) and the HTTP status, using a
       * single network call.
       */
      let thrown: unknown;
      try {
        await client.createComposition({ title: "should-fail", visibility: "unlisted" });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ApiError);
      expect((thrown as ApiError).status).toBe(403);
    }
  );
});
