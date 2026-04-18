/**
 * Tests for the device-code auth client.
 *
 * We drive the client with a stub fetch rather than MSW here: the wizard's
 * auth flow only makes two calls and the stub is considerably easier to
 * reason about than an MSW setup that's only used in one file.
 */

import { describe, it, expect, vi } from "vitest";
import { authenticate, AuthError, VERIFY_URL_MARKER_PREFIX } from "./auth.js";
import type { WizardOptions } from "./types.js";

const baseOptions: WizardOptions = {
  cwd: "/tmp/fx",
  apiBaseUrl: "http://api.test",
  webBaseUrl: "http://web.test",
  nonInteractive: false,
  skipInstall: false,
  skipScaffold: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function makeFetch(handler: FetchHandler): typeof globalThis.fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as unknown as typeof globalThis.fetch;
}

describe("authenticate", () => {
  it("returns keys after a successful init + poll", async () => {
    const calls: string[] = [];
    let pollCount = 0;
    const fetch = makeFetch(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/api/cli/auth/init")) {
        return jsonResponse(201, {
          pollToken: "poll-token-abc",
          code: "ALPHA-BRAVO-CHARLIE",
          verificationUrl: "http://web.test/cli/auth",
          expiresIn: 600,
        });
      }
      if (url.startsWith("http://api.test/api/cli/auth/poll")) {
        pollCount++;
        if (pollCount === 1) return jsonResponse(202, { status: "pending" });
        return jsonResponse(200, { publishableKey: "pk_test_123", secretKey: null });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const openBrowser = vi.fn(async () => {});
    const sleep = vi.fn(async () => {});

    const keys = await authenticate(baseOptions, {
      fetch,
      openBrowser,
      sleep,
      pollIntervalMs: 10,
      maxPollMs: 5000,
    });

    expect(keys.publishableKey).toBe("pk_test_123");
    expect(keys.secretKey).toBeUndefined();
    expect(openBrowser).toHaveBeenCalledWith(
      expect.stringContaining("http://web.test/cli/auth?code=ALPHA-BRAVO-CHARLIE")
    );
    expect(calls[0]).toBe("POST http://api.test/api/cli/auth/init");
    expect(pollCount).toBe(2);
  });

  it("surfaces expired sessions as AuthError(expired)", async () => {
    const fetch = makeFetch(async (url) => {
      if (url.endsWith("/api/cli/auth/init")) {
        return jsonResponse(201, {
          pollToken: "tok",
          code: "ALPHA-BRAVO-CHARLIE",
          verificationUrl: "http://web.test/cli/auth",
          expiresIn: 600,
        });
      }
      return jsonResponse(410, { error: "expired" });
    });

    await expect(
      authenticate(baseOptions, {
        fetch,
        openBrowser: async () => {},
        sleep: async () => {},
        pollIntervalMs: 1,
        maxPollMs: 1000,
      })
    ).rejects.toMatchObject({ name: "AuthError", kind: "expired" });
  });

  it("surfaces consumed sessions as AuthError(consumed)", async () => {
    const fetch = makeFetch(async (url) => {
      if (url.endsWith("/api/cli/auth/init")) {
        return jsonResponse(201, {
          pollToken: "tok",
          code: "DELTA-ECHO-FOXTROT",
          verificationUrl: "http://web.test/cli/auth",
          expiresIn: 600,
        });
      }
      return jsonResponse(409, { error: "consumed" });
    });

    await expect(
      authenticate(baseOptions, {
        fetch,
        openBrowser: async () => {},
        sleep: async () => {},
        pollIntervalMs: 1,
        maxPollMs: 1000,
      })
    ).rejects.toMatchObject({ name: "AuthError", kind: "consumed" });
  });

  it("times out after maxPollMs if server keeps returning 202", async () => {
    let pollCount = 0;
    const fetch = makeFetch(async (url) => {
      if (url.endsWith("/api/cli/auth/init")) {
        return jsonResponse(201, {
          pollToken: "tok",
          code: "GOLF-HOTEL-INDIA",
          verificationUrl: "http://web.test/cli/auth",
          expiresIn: 600,
        });
      }
      pollCount++;
      return jsonResponse(202, { status: "pending" });
    });

    const sleep = vi.fn(async () => {});

    await expect(
      authenticate(baseOptions, {
        fetch,
        openBrowser: async () => {},
        sleep,
        pollIntervalMs: 10,
        maxPollMs: 0,
      })
    ).rejects.toMatchObject({ name: "AuthError", kind: "timeout" });

    expect(pollCount).toBeGreaterThanOrEqual(0);
  });

  it("fails fast with AuthError(network) when init throws", async () => {
    const fetch = makeFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      authenticate(baseOptions, {
        fetch,
        openBrowser: async () => {},
        sleep: async () => {},
        pollIntervalMs: 1,
        maxPollMs: 100,
      })
    ).rejects.toMatchObject({ name: "AuthError", kind: "network" });
  });

  it("AuthError is a real subclass with a kind tag", () => {
    const err = new AuthError("boom", "timeout");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AuthError");
    expect(err.kind).toBe("timeout");
  });

  it("prefers options.openBrowser over the platform opener", async () => {
    const fetch = makeFetch(async (url) => {
      if (url.endsWith("/api/cli/auth/init")) {
        return jsonResponse(201, {
          pollToken: "tok",
          code: "JULIET-KILO-LIMA",
          verificationUrl: "http://web.test/cli/auth",
          expiresIn: 600,
        });
      }
      return jsonResponse(200, { publishableKey: "pk_abc", secretKey: "sk_abc" });
    });

    const optionsOpenBrowser = vi.fn(async () => {});
    await authenticate(
      { ...baseOptions, openBrowser: optionsOpenBrowser },
      { fetch, sleep: async () => {}, pollIntervalMs: 1, maxPollMs: 1000 }
    );

    expect(optionsOpenBrowser).toHaveBeenCalledWith(
      expect.stringContaining("http://web.test/cli/auth?code=JULIET-KILO-LIMA")
    );
  });

  it("prefers deps.openBrowser over options.openBrowser (test override wins)", async () => {
    const fetch = makeFetch(async (url) => {
      if (url.endsWith("/api/cli/auth/init")) {
        return jsonResponse(201, {
          pollToken: "tok",
          code: "MIKE-NOVEMBER-OSCAR",
          verificationUrl: "http://web.test/cli/auth",
          expiresIn: 600,
        });
      }
      return jsonResponse(200, { publishableKey: "pk_abc", secretKey: null });
    });

    const optionsOpenBrowser = vi.fn(async () => {});
    const depsOpenBrowser = vi.fn(async () => {});

    await authenticate(
      { ...baseOptions, openBrowser: optionsOpenBrowser },
      {
        fetch,
        openBrowser: depsOpenBrowser,
        sleep: async () => {},
        pollIntervalMs: 1,
        maxPollMs: 1000,
      }
    );

    expect(depsOpenBrowser).toHaveBeenCalledOnce();
    expect(optionsOpenBrowser).not.toHaveBeenCalled();
  });

  it("prints a stable stdout marker line for machine consumers", async () => {
    const fetch = makeFetch(async (url) => {
      if (url.endsWith("/api/cli/auth/init")) {
        return jsonResponse(201, {
          pollToken: "tok",
          code: "PAPA-QUEBEC-ROMEO",
          verificationUrl: "http://web.test/cli/auth",
          expiresIn: 600,
        });
      }
      return jsonResponse(200, { publishableKey: "pk_marker", secretKey: null });
    });

    /*
     * Spy on console.log so the test stays terminal-agnostic -- clack writes
     * to process.stdout via its own renderer, so intercepting stdout bytes
     * directly would catch both the marker and clack's decorative output.
     */
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await authenticate(baseOptions, {
        fetch,
        openBrowser: async () => {},
        sleep: async () => {},
        pollIntervalMs: 1,
        maxPollMs: 1000,
      });

      const markerCalls = logSpy.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].startsWith(VERIFY_URL_MARKER_PREFIX)
      );
      expect(markerCalls).toHaveLength(1);
      expect(markerCalls[0][0]).toBe(
        `${VERIFY_URL_MARKER_PREFIX}http://web.test/cli/auth?code=PAPA-QUEBEC-ROMEO`
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});
