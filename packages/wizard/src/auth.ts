/**
 * Device-code authentication client.
 *
 * Matches the three-step dance implemented by the server in
 * api/src/routes/cli-auth.ts:
 *
 *   1. POST /api/cli/auth/init  -> { pollToken, code, verificationUrl, expiresIn }
 *   2. Browser visits verificationUrl, user signs in (Clerk) and confirms the
 *      code; server-side /claim provisions the API key and attaches it to
 *      the session.
 *   3. CLI long-polls GET /api/cli/auth/poll?token=... until 200 (keys) or a
 *      terminal error (410 expired, 409 consumed, 404 not found).
 *
 * We deliberately use the platform `open` command instead of a dependency
 * like `open`-the-npm-package: Node's standard library + execa keeps the
 * wizard's dep surface small, and the command is trivially overridable for
 * testing via the `openBrowser` argument.
 */

import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { execa } from "execa";
import type { ApiKeys, WizardOptions } from "./types.js";

interface InitResponse {
  pollToken: string;
  code: string;
  verificationUrl: string;
  expiresIn: number;
}

interface PollSuccessResponse {
  publishableKey: string;
  secretKey: string | null;
}

export interface AuthDependencies {
  /**
   * Injection seam for tests. Defaults to global fetch.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * Injection seam for tests. Defaults to the platform open command.
   */
  openBrowser?: (url: string) => Promise<void>;
  /**
   * Injection seam for tests. Sleep between poll attempts.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Milliseconds between poll attempts while session is pending. The server
   * expires sessions after ~10 minutes so this is a ceiling.
   */
  pollIntervalMs?: number;
  /**
   * Hard cap on total poll duration, to prevent an abandoned wizard from
   * hanging forever in CI/detached terminals.
   */
  maxPollMs?: number;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "expired" | "consumed" | "not_found" | "bad_response" | "timeout"
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Heuristic client label shown to the user when they confirm the code. Keeps
 * them oriented if they have several tabs open. Kept deliberately minimal --
 * no user-identifying data beyond the hostname and short cwd basename.
 */
function defaultClientLabel(cwd: string): string {
  const host = os.hostname().slice(0, 40);
  const dir = cwd.split(/[\\/]/).filter(Boolean).pop() ?? "project";
  return `${dir} on ${host}`;
}

function platformOpenCommand(): { cmd: string; args: (url: string) => string[] } {
  switch (process.platform) {
    case "darwin":
      return { cmd: "open", args: (url) => [url] };
    case "win32":
      return { cmd: "cmd", args: (url) => ["/c", "start", "", url] };
    default:
      return { cmd: "xdg-open", args: (url) => [url] };
  }
}

async function defaultOpenBrowser(url: string): Promise<void> {
  const { cmd, args } = platformOpenCommand();
  try {
    await execa(cmd, args(url), { stdio: "ignore" });
  } catch {
    /*
     * Failing to auto-open is never fatal: the user can click the printed
     * link. We swallow here so a missing xdg-open on a headless server
     * doesn't abort the wizard.
     */
  }
}

/*
 * Stable stdout line used by e2e tests that spawn the CLI as a subprocess.
 * Emitted on its own line so tests can scrape it from stdout without parsing
 * clack's bordered UI. Kept as a constant so the marker stays greppable in
 * both directions (emitter and consumer).
 */
export const VERIFY_URL_MARKER_PREFIX = "underscore-wizard: verify at ";

export async function authenticate(
  options: WizardOptions,
  deps: AuthDependencies = {}
): Promise<ApiKeys> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const openBrowser = deps.openBrowser ?? options.openBrowser ?? defaultOpenBrowser;
  const sleep = deps.sleep ?? delay;
  const pollIntervalMs = deps.pollIntervalMs ?? 2_000;
  const maxPollMs = deps.maxPollMs ?? 10 * 60 * 1_000;

  const spinner = p.spinner();
  spinner.start("Requesting an authentication code...");

  let init: InitResponse;
  try {
    const res = await fetchImpl(`${options.apiBaseUrl}/api/cli/auth/init`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientLabel: defaultClientLabel(options.cwd) }),
    });
    if (!res.ok) {
      throw new AuthError(`init failed with status ${res.status}`, "bad_response");
    }
    init = (await res.json()) as InitResponse;
  } catch (err) {
    spinner.stop("Failed to request authentication code.");
    if (err instanceof AuthError) throw err;
    throw new AuthError(
      `Could not reach ${options.apiBaseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      "network"
    );
  }

  spinner.stop("Got a code. Opening your browser...");

  const verifyUrl = `${init.verificationUrl}?code=${encodeURIComponent(init.code)}`;

  p.note(
    [
      `Visit: ${pc.cyan(verifyUrl)}`,
      "",
      `Verification code: ${pc.bold(pc.yellow(init.code))}`,
      "",
      "If the browser doesn't open automatically, paste the URL above.",
    ].join("\n"),
    "Sign in to Underscore"
  );

  /*
   * Raw stdout marker for machine consumers (e2e tests spawning the CLI).
   * Clack's p.note draws a bordered box with ANSI codes; scraping that is
   * brittle. A plain console.log on its own line is trivial to grep for.
   */
  console.log(`${VERIFY_URL_MARKER_PREFIX}${verifyUrl}`);

  await openBrowser(verifyUrl);

  const pollSpinner = p.spinner();
  pollSpinner.start("Waiting for you to confirm in the browser...");

  const keys = await pollForKeys(options.apiBaseUrl, init.pollToken, {
    fetch: fetchImpl,
    sleep,
    pollIntervalMs,
    maxPollMs,
  });

  pollSpinner.stop("Signed in.");
  return keys;
}

interface PollDeps {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  pollIntervalMs: number;
  maxPollMs: number;
}

async function pollForKeys(
  apiBaseUrl: string,
  pollToken: string,
  deps: PollDeps
): Promise<ApiKeys> {
  const start = Date.now();
  const url = `${apiBaseUrl}/api/cli/auth/poll?token=${encodeURIComponent(pollToken)}`;

  while (true) {
    if (Date.now() - start > deps.maxPollMs) {
      throw new AuthError("Timed out waiting for browser confirmation.", "timeout");
    }

    let res: Response;
    try {
      res = await deps.fetch(url, { method: "GET" });
    } catch (err) {
      throw new AuthError(
        `Poll failed: ${err instanceof Error ? err.message : String(err)}`,
        "network"
      );
    }

    if (res.status === 200) {
      const body = (await res.json()) as PollSuccessResponse;
      if (!body.publishableKey) {
        throw new AuthError("Server returned an empty publishable key.", "bad_response");
      }
      return {
        publishableKey: body.publishableKey,
        secretKey: body.secretKey ?? undefined,
      };
    }

    if (res.status === 202) {
      await deps.sleep(deps.pollIntervalMs);
      continue;
    }

    if (res.status === 410) throw new AuthError("Authentication code expired.", "expired");
    if (res.status === 409) throw new AuthError("Authentication session was already consumed.", "consumed");
    if (res.status === 404) throw new AuthError("Authentication session not found.", "not_found");

    /*
     * Any other status is probably transient (5xx) or a breaking server
     * change. Retry once after a longer backoff; if we still see it we
     * surface it as bad_response so the user can see the status code.
     */
    await deps.sleep(deps.pollIntervalMs * 2);
    throw new AuthError(`Unexpected poll status ${res.status}.`, "bad_response");
  }
}
