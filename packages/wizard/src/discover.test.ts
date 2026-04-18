/**
 * Tests for the discover client.
 */

import { describe, it, expect, vi } from "vitest";
import { buildDiscoverUrl, pickStarterCompositions } from "./discover.js";
import type { WizardOptions } from "./types.js";

const baseOptions: WizardOptions = {
  cwd: "/tmp/fx",
  apiBaseUrl: "http://api.test",
  webBaseUrl: "http://web.test",
  nonInteractive: false,
  skipInstall: false,
  skipScaffold: false,
};

describe("buildDiscoverUrl", () => {
  it("encodes tags and limit as query params", () => {
    expect(buildDiscoverUrl("http://api.test", ["retro", "game"], 5)).toBe(
      "http://api.test/api/v1/discover?tags=retro%2Cgame&limit=5"
    );
  });

  it("omits tags when empty", () => {
    expect(buildDiscoverUrl("http://api.test", [], 5)).toBe(
      "http://api.test/api/v1/discover?limit=5"
    );
  });
});

describe("pickStarterCompositions", () => {
  it("returns the compositions array from the response", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          compositions: [{ id: "cmp_1", title: "A", tags: ["retro"], previewSynthName: "p" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof globalThis.fetch;

    const result = await pickStarterCompositions(baseOptions, ["retro"], { fetch });
    expect(result).toEqual([{ id: "cmp_1", title: "A", tags: ["retro"], previewSynthName: "p" }]);
  });

  it("returns an empty list on a non-OK response (fail-open)", async () => {
    const fetch = vi.fn(
      async () => new Response("boom", { status: 500 })
    ) as unknown as typeof globalThis.fetch;
    const result = await pickStarterCompositions(baseOptions, ["retro"], { fetch });
    expect(result).toEqual([]);
  });

  it("returns an empty list on network error", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    const result = await pickStarterCompositions(baseOptions, ["retro"], { fetch });
    expect(result).toEqual([]);
  });

  it("returns an empty list when the body is malformed", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("not json", { status: 200, headers: { "content-type": "application/json" } })
    ) as unknown as typeof globalThis.fetch;
    const result = await pickStarterCompositions(baseOptions, ["retro"], { fetch });
    expect(result).toEqual([]);
  });

  it("aborts via timeout without hanging", async () => {
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    ) as unknown as typeof globalThis.fetch;

    const result = await pickStarterCompositions(baseOptions, ["retro"], {
      fetch,
      timeoutMs: 5,
    });
    expect(result).toEqual([]);
  });
});
