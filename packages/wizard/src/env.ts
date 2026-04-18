/**
 * Safe writer for `.env.local` / `.env`.
 *
 * We pick env var names based on framework conventions so the key is usable
 * at runtime without the user needing to configure their bundler. For
 * bundlers that whitelist by prefix (Vite, Next) the publishable key needs
 * the framework's public prefix; the secret key stays unprefixed so it's
 * only available on the server.
 *
 * Collision behavior: if a target key already exists in the env file we
 * leave it untouched and emit a collision entry. The orchestrator decides
 * whether to overwrite (in interactive mode, after confirmation) or warn
 * the user to update it manually. Silently overwriting would violate the
 * "no hidden file mutations" principle.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { ApiKeys, DetectedProject, Framework } from "./types.js";

export interface EnvVarSpec {
  key: string;
  value: string;
  /**
   * True if the variable is intended to be exposed to client-side code by
   * the detected framework. This is informational only; we don't use it to
   * decide behavior but surface it so tests and the UI can confirm the
   * right prefix was chosen.
   */
  exposedToClient: boolean;
  /**
   * A short comment the writer places above the key on first write so the
   * user has context about what it's for.
   */
  comment: string;
}

export function envVarSpecs(framework: Framework, keys: ApiKeys): EnvVarSpec[] {
  const specs: EnvVarSpec[] = [];
  specs.push({
    key: publishableKeyName(framework),
    value: keys.publishableKey,
    exposedToClient: true,
    comment: "Publishable key for the Underscore web SDK (safe to expose to clients).",
  });

  if (keys.secretKey) {
    specs.push({
      key: "UNDERSCORE_SECRET_KEY",
      value: keys.secretKey,
      exposedToClient: false,
      comment: "Secret key for Underscore server-side generation endpoints. Do NOT commit.",
    });
  }

  return specs;
}

function publishableKeyName(framework: Framework): string {
  switch (framework) {
    case "vite-vanilla":
    case "vite-react":
    case "vite-vue":
    case "vite-svelte":
      return "VITE_UNDERSCORE_PUBLISHABLE_KEY";
    case "next-app":
    case "next-pages":
      return "NEXT_PUBLIC_UNDERSCORE_PUBLISHABLE_KEY";
    case "vanilla-html":
    case "unknown":
      return "UNDERSCORE_PUBLISHABLE_KEY";
  }
}

export interface WriteEnvResult {
  path: string;
  added: string[];
  existingKeysSkipped: string[];
}

/**
 * Parse existing env keys out of file contents. We are deliberately
 * permissive: we only try to extract the set of keys, not their values.
 * Comments (`#`) and blank lines are skipped. We don't attempt to parse
 * full dotenv syntax (export keyword, multiline strings) because we never
 * rewrite values; we only need to detect whether a key already exists.
 */
export function parseEnvKeys(contents: string): Set<string> {
  const keys = new Set<string>();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z0-9_]+)\s*=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

export async function writeEnv(project: DetectedProject, keys: ApiKeys): Promise<string> {
  const result = await writeEnvDetailed(project, keys);
  return result.path;
}

export async function writeEnvDetailed(
  project: DetectedProject,
  keys: ApiKeys
): Promise<WriteEnvResult> {
  const abs = join(project.root, project.envFile);
  const specs = envVarSpecs(project.framework, keys);

  let existing = "";
  try {
    existing = await fs.readFile(abs, "utf8");
  } catch {
    existing = "";
  }

  const existingKeys = parseEnvKeys(existing);

  const toAppend: string[] = [];
  const added: string[] = [];
  const skipped: string[] = [];

  for (const spec of specs) {
    if (existingKeys.has(spec.key)) {
      skipped.push(spec.key);
      continue;
    }
    toAppend.push(`# ${spec.comment}`);
    toAppend.push(`${spec.key}=${spec.value}`);
    toAppend.push("");
    added.push(spec.key);
  }

  if (toAppend.length === 0) {
    return { path: abs, added, existingKeysSkipped: skipped };
  }

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : existing.length > 0 ? "\n" : "";
  const next = existing + separator + toAppend.join("\n").replace(/\n$/, "") + "\n";

  await fs.writeFile(abs, next, "utf8");
  return { path: abs, added, existingKeysSkipped: skipped };
}
