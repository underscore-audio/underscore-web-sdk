/*
 * Vitest globalSetup for the live test suite.
 *
 * The full end-to-end harness (user provisioning, API key minting,
 * test-data seeding) lives in the backend repo and invokes
 * `npm run test:live` here after exporting UNDERSCORE_* env vars.
 * This file makes that contract explicit: if the env vars aren't set,
 * it prints a clear message instead of letting tests skip silently.
 *
 * Manual override: set UNDERSCORE_PUBLISHABLE_KEY and
 * UNDERSCORE_TEST_COMPOSITION_ID by hand to debug against a
 * long-lived composition without the full harness.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface SetupContext {
  bypassed: boolean;
}

const UNDERSCORE_VERSION_FILE = ".underscore-version";

function readPinnedUnderscoreSha(): string | null {
  try {
    const sha = readFileSync(join(process.cwd(), UNDERSCORE_VERSION_FILE), "utf-8").trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

function printBanner(): void {
  const baseUrl = process.env.UNDERSCORE_BASE_URL || "http://localhost:3333";
  const pinnedSha = readPinnedUnderscoreSha();
  const liveSha = process.env.UNDERSCORE_TEST_API_SHA;
  console.log("==> @underscore-audio/sdk live tests");
  console.log(`    base URL:           ${baseUrl}`);
  if (pinnedSha) {
    console.log(`    .underscore-version: ${pinnedSha}`);
  }
  if (liveSha) {
    console.log(`    api SHA reported:    ${liveSha}`);
    if (pinnedSha && pinnedSha !== liveSha) {
      console.log("    WARNING: api SHA does not match .underscore-version pin.");
    }
  }
  if (!liveSha && !pinnedSha) {
    console.log("    (no .underscore-version pin and api did not report a SHA)");
  }
}

/*
 * Vitest calls the default export once before any test file loads,
 * and the returned function (if any) once after all tests complete.
 *
 * We deliberately do NOT throw when env vars are missing: the existing
 * suites already handle that via `describe.skipIf(...)` with informative
 * messages, and a hard fail here would prevent CI from running the
 * SDK's manual-override test path. Instead we print the contract once
 * up front so a "0 tests ran" result has a clear cause.
 */
export default async function setup(): Promise<() => Promise<void>> {
  printBanner();

  const ctx: SetupContext = {
    bypassed: !!process.env.UNDERSCORE_PUBLISHABLE_KEY,
  };

  if (!ctx.bypassed) {
    console.log("    UNDERSCORE_PUBLISHABLE_KEY not set: live tests will skip.");
    console.log("    To run end-to-end against the underscore stack, use");
    console.log("    `make test-sdk` from the underscore monorepo.");
    console.log("    To target a long-lived composition manually, see CONTRIBUTING.md.");
  }

  return async () => {
    /*
     * Per-process teardown happens here. We have nothing to clean up
     * directly because Clerk users + compositions are owned by the
     * underscore-side runner script, which deletes them in its own
     * try/finally. This hook stays a no-op intentionally.
     */
  };
}
