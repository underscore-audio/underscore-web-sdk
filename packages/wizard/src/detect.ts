/**
 * Project detection.
 *
 * The wizard's first job is to figure out what it's looking at: a Vite React
 * app? Next.js app router? Plain HTML? This module does that by reading a
 * narrow set of well-known files (package.json, lockfiles, common config
 * names) and returns a typed {@link DetectedProject}.
 *
 * Design notes:
 * - Detection is read-only. It never writes or installs.
 * - We prefer evidence that's hard to fake (dependency entries in
 *   package.json, presence of a framework-specific config file) over
 *   filename heuristics alone.
 * - Unknown projects are supported: we fall back to `vanilla-html` or
 *   `unknown`, and the wizard reports this clearly to the user rather than
 *   guessing wrong and writing bad code.
 * - `publicDir` is the directory where the wizard will place WASM assets.
 *   For Next.js that's always `public/`, for Vite it's `public/` by default
 *   but can be overridden in vite.config; detection here returns the
 *   convention and patchers can adjust later if needed.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { DetectedProject, Framework, PackageManager, WizardOptions } from "./types.js";

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  packageManager?: string;
  scripts?: Record<string, string>;
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  try {
    const contents = await fs.readFile(join(root, "package.json"), "utf8");
    return JSON.parse(contents) as PackageJson;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export function hasDependency(pkg: PackageJson | null, name: string): boolean {
  if (!pkg) return false;
  return Boolean(
    pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? pkg.peerDependencies?.[name]
  );
}

/**
 * Package-manager detection: the `packageManager` field in package.json is
 * the strongest signal (Corepack convention), followed by the presence of a
 * specific lockfile. We deliberately don't probe `which pnpm`/`which yarn`
 * because the installed global tools may not match what the project uses.
 */
export async function detectPackageManager(
  root: string,
  pkg: PackageJson | null
): Promise<PackageManager> {
  if (pkg?.packageManager) {
    const name = pkg.packageManager.split("@", 1)[0];
    if (name === "pnpm" || name === "yarn" || name === "bun" || name === "npm") {
      return name;
    }
  }
  if (await exists(join(root, "bun.lockb"))) return "bun";
  if (await exists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

interface FrameworkDetection {
  framework: Framework;
  configFile: string | null;
  entryFile: string | null;
  publicDir: string;
}

/**
 * Framework detection order matters: more specific frameworks are checked
 * before less specific ones. For example a Next.js project may also have
 * React listed as a dependency, so Next.js must be considered first.
 */
export async function detectFramework(
  root: string,
  pkg: PackageJson | null
): Promise<FrameworkDetection> {
  if (hasDependency(pkg, "next")) {
    const appDir = (await exists(join(root, "app"))) || (await exists(join(root, "src/app")));
    const pagesDir =
      (await exists(join(root, "pages"))) || (await exists(join(root, "src/pages")));
    const configFile =
      (await firstExisting(root, ["next.config.mjs", "next.config.js", "next.config.ts"])) ?? null;
    const isAppRouter = appDir && !pagesDir;
    return {
      framework: isAppRouter ? "next-app" : "next-pages",
      configFile,
      entryFile: null,
      publicDir: "public",
    };
  }

  if (hasDependency(pkg, "vite")) {
    const configFile =
      (await firstExisting(root, ["vite.config.ts", "vite.config.js", "vite.config.mjs"])) ?? null;
    const framework: Framework = hasDependency(pkg, "react")
      ? "vite-react"
      : hasDependency(pkg, "vue")
        ? "vite-vue"
        : hasDependency(pkg, "svelte")
          ? "vite-svelte"
          : "vite-vanilla";
    const entryFile = await firstExisting(root, [
      "src/main.ts",
      "src/main.tsx",
      "src/main.js",
      "src/main.jsx",
      "src/index.ts",
      "src/index.tsx",
    ]);
    return {
      framework,
      configFile,
      entryFile,
      publicDir: "public",
    };
  }

  if (await exists(join(root, "index.html"))) {
    return {
      framework: "vanilla-html",
      configFile: null,
      entryFile: "index.html",
      publicDir: ".",
    };
  }

  return {
    framework: "unknown",
    configFile: null,
    entryFile: null,
    publicDir: "public",
  };
}

async function firstExisting(root: string, candidates: string[]): Promise<string | null> {
  for (const rel of candidates) {
    if (await exists(join(root, rel))) return rel;
  }
  return null;
}

/**
 * Picks the default env file for the detected framework. Next.js reads
 * `.env.local` automatically and gitignores it; Vite does the same. For
 * vanilla HTML projects `.env` is the closest approximation - the wizard
 * will warn that those env vars won't be automatically surfaced.
 */
export function defaultEnvFile(framework: Framework): string {
  if (framework === "vanilla-html" || framework === "unknown") return ".env";
  return ".env.local";
}

export async function detectProject(options: WizardOptions): Promise<DetectedProject> {
  const { cwd } = options;
  const pkg = await readPackageJson(cwd);
  const packageManager = await detectPackageManager(cwd, pkg);
  const framework = await detectFramework(cwd, pkg);

  return {
    root: cwd,
    framework: framework.framework,
    packageManager,
    publicDir: framework.publicDir,
    envFile: defaultEnvFile(framework.framework),
    configFile: framework.configFile,
    entryFile: framework.entryFile,
  };
}
