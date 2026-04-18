/**
 * Client for the GET /api/v1/discover endpoint.
 *
 * The wizard passes tags from scan.ts and gets back a small set of curated
 * starter compositions. We intentionally do not require authentication: the
 * discover endpoint returns only public compositions and is rate-limited on
 * the server side.
 *
 * Failure mode: if the endpoint is unreachable or returns an error, we
 * return an empty list and the orchestrator falls back to scaffolding a
 * demo without a specific composition id. The wizard still finishes
 * successfully -- the user can always pick compositions in the dashboard.
 */

import type { DiscoverComposition, WizardOptions } from "./types.js";

const DEFAULT_LIMIT = 5;

export interface DiscoverDependencies {
  fetch?: typeof globalThis.fetch;
  /**
   * Hard timeout for the discover call. The wizard should not hang here --
   * defaulting to 5s keeps the UX crisp even on flaky networks.
   */
  timeoutMs?: number;
}

export async function pickStarterCompositions(
  options: WizardOptions,
  tags: string[],
  deps: DiscoverDependencies = {}
): Promise<DiscoverComposition[]> {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? 5_000;

  const url = buildDiscoverUrl(options.apiBaseUrl, tags, DEFAULT_LIMIT);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { compositions?: DiscoverComposition[] };
    return Array.isArray(body.compositions) ? body.compositions : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function buildDiscoverUrl(apiBaseUrl: string, tags: string[], limit: number): string {
  const params = new URLSearchParams();
  if (tags.length > 0) params.set("tags", tags.join(","));
  params.set("limit", String(limit));
  return `${apiBaseUrl}/api/v1/discover?${params.toString()}`;
}
