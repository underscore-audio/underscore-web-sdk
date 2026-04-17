/*
 * Configuration for the live test suite.
 *
 * Live tests talk to a real running Underscore API (local or production).
 * All credentials and the API base URL come from environment variables so
 * the same harness works against `http://localhost:3333` (default) and
 * `https://underscore.audio` with no code changes.
 *
 * Every variable is optional at the process level. Individual suites
 * inspect the returned `LiveConfig` and use `describe.skipIf(...)` to
 * skip gracefully when the variables they need are missing. This is
 * deliberate: it lets `npm run test:live` pass on a machine with no
 * credentials (CI forks, open-source contributors) while still being
 * meaningful for maintainers who do have them.
 */
export interface LiveConfig {
  baseUrl: string;
  publishableKey?: string;
  secretKey?: string;
  compositionId?: string;
  synthName?: string;
  runGeneration: boolean;
}

const DEFAULT_BASE_URL = "http://localhost:3333";

export function loadLiveConfig(): LiveConfig {
  const baseUrl = process.env.UNDERSCORE_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return {
    baseUrl,
    publishableKey: nonEmpty(process.env.UNDERSCORE_PUBLISHABLE_KEY),
    secretKey: nonEmpty(process.env.UNDERSCORE_SECRET_KEY),
    compositionId: nonEmpty(process.env.UNDERSCORE_TEST_COMPOSITION_ID),
    synthName: nonEmpty(process.env.UNDERSCORE_TEST_SYNTH_NAME),
    runGeneration: process.env.UNDERSCORE_LIVE_GENERATION === "1",
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/*
 * Returns true if the live suite can access the local/remote API at all.
 * A quick health probe so failures fail fast with a clear message instead
 * of each test independently timing out against a dead URL.
 */
export async function pingApi(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
