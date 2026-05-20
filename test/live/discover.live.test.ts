/*
 * Discover live test.
 *
 * The install wizard calls this endpoint before it has API keys in hand, so
 * the observable contract is intentionally small: no authentication required,
 * and the response always validates as a discover response even when no
 * starter compositions are configured.
 */

import { describe, it, expect } from "vitest";
import { DiscoverResponseSchema } from "../../src/schemas.js";
import { loadLiveConfig, pingApi } from "./config.js";

const cfg = loadLiveConfig();

describe("live: discover", () => {
  it("returns the public discover response shape without an API key", async () => {
    if (!(await pingApi(cfg.baseUrl))) {
      console.warn(`[live:discover] skipping: cannot reach API at ${cfg.baseUrl}`);
      return;
    }

    const response = await fetch(`${cfg.baseUrl}/api/v1/discover?limit=1`);
    expect(response.status).not.toBe(401);
    expect(response.ok).toBe(true);

    const parsed = DiscoverResponseSchema.parse(await response.json());
    expect(Array.isArray(parsed.compositions)).toBe(true);
  });
});
