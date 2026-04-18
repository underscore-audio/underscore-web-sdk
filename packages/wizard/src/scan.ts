/**
 * Light keyword scan to infer the "vibe" of the project.
 *
 * Design constraints:
 *  - Read a small fixed set of files (package.json, entry, README). A cap on
 *    bytes per file and total file count keeps scan latency bounded.
 *  - Never upload or transmit file contents. Only a list of tag-like
 *    keywords is ever sent to the discover endpoint.
 *  - Fail open: if scanning hits any error we return an empty list and the
 *    caller falls back to generic starter sounds.
 *
 * The tag vocabulary is intentionally small. The server-side discover
 * endpoint filters by tag intersection, so over-specific keywords ("fog")
 * would shrink the result set to zero. We pick coarse buckets that starter
 * compositions can be tagged with.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { DetectedProject } from "./types.js";

const MAX_FILE_BYTES = 20_000;
const MAX_FILES_SCANNED = 6;
const MAX_TAGS_RETURNED = 4;

/**
 * Keyword -> tag mapping. Keywords are matched case-insensitively as whole
 * words against the concatenated content of the scanned files. The mapping
 * is intentionally conservative: overly-general words like "app" or "site"
 * would produce noise.
 */
const KEYWORD_TO_TAG: Array<[RegExp, string]> = [
  [/\b(game|gaming|level|enemy|player|roguelike|rpg|arcade)\b/i, "game"],
  [/\b(retro|pixel|8[-\s]?bit|16[-\s]?bit|nes|snes)\b/i, "retro"],
  [/\b(chiptune|synthwave|arcade|8bit)\b/i, "chiptune"],
  [/\b(ambient|calm|meditate|meditation|zen|focus|focusmode)\b/i, "ambient"],
  [/\b(lofi|lo[-\s]?fi|study|sleep|relax)\b/i, "lofi"],
  [/\b(dashboard|analytics|chart|metric|admin)\b/i, "ui"],
  [/\b(notif(y|ication)?|toast|alert|ping|chime)\b/i, "ui"],
  [/\b(ecommerce|e[-\s]?commerce|shop|store|cart|checkout|product)\b/i, "commerce"],
  [/\b(portfolio|blog|personal|website|landing)\b/i, "portfolio"],
  [/\b(cinema|cinematic|trailer|movie|film)\b/i, "cinematic"],
  [/\b(horror|spooky|dark|scary|haunt(ed|ing))\b/i, "dark"],
  [/\b(percussion|drum|beat|rhythm)\b/i, "percussion"],
  [/\b(pad|atmos|atmosphere|texture|drone)\b/i, "pad"],
];

export async function scanProjectForTags(project: DetectedProject): Promise<string[]> {
  const candidates = candidateFiles(project);
  const contents: string[] = [];

  for (const rel of candidates) {
    if (contents.length >= MAX_FILES_SCANNED) break;
    try {
      const text = await readCapped(join(project.root, rel));
      if (text) contents.push(text);
    } catch {
      /* skip unreadable files */
    }
  }

  return extractTags(contents.join("\n"));
}

function candidateFiles(project: DetectedProject): string[] {
  const list: string[] = ["package.json", "README.md", "readme.md"];
  if (project.entryFile) list.push(project.entryFile);

  // Common framework-specific files, added last (scan order prioritizes
  // package.json / README as those best describe "what this app is about").
  if (project.framework.startsWith("vite-")) {
    list.push("src/App.tsx", "src/App.jsx", "src/App.vue", "src/App.svelte");
  } else if (project.framework === "next-app") {
    list.push("app/page.tsx", "app/layout.tsx");
  } else if (project.framework === "next-pages") {
    list.push("pages/index.tsx", "pages/_app.tsx");
  } else if (project.framework === "vanilla-html") {
    list.push("index.html");
  }

  return list;
}

async function readCapped(abs: string): Promise<string | null> {
  const handle = await fs.open(abs, "r");
  try {
    const buffer = Buffer.alloc(MAX_FILE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_FILE_BYTES, 0);
    return buffer.slice(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export function extractTags(haystack: string): string[] {
  const found = new Set<string>();
  for (const [pattern, tag] of KEYWORD_TO_TAG) {
    if (found.has(tag)) continue;
    if (pattern.test(haystack)) found.add(tag);
    if (found.size >= MAX_TAGS_RETURNED) break;
  }
  return [...found];
}
