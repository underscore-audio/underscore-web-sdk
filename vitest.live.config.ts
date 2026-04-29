import { defineConfig } from "vitest/config";

/*
 * Live test configuration.
 *
 * Runs only files under test/live/ against a real running Underscore API
 * (local or production, selected via env vars). Kept separate from the
 * default mocked suite so:
 *
 *  - `npm test` stays fast, hermetic, and has no network dependency.
 *  - `npm run test:live` can opt into longer timeouts and real fetch.
 *
 * `globalSetup` runs once before any test file and emits a SHA banner
 * + sanity-checks env-var presence. The actual fixture provisioning
 * (Clerk user, API keys, seeded composition) is owned by the
 * underscore monorepo's `make test-sdk` runner -- see
 * test/live/global-setup.ts for why.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/live/**/*.test.ts"],
    setupFiles: ["./test/live/setup.ts"],
    globalSetup: ["./test/live/global-setup.ts"],
    // Generation tests can take 30-120s end-to-end. Give them headroom
    // without letting a truly hung job block CI forever.
    testTimeout: 180_000,
    hookTimeout: 30_000,
    // Serial execution keeps live-test failures easy to read and avoids
    // accidentally hammering a shared API.
    pool: "forks",
    maxConcurrency: 1,
    fileParallelism: false,
  },
});
