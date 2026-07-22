#!/usr/bin/env node
/**
 * CLI tool to copy the supersonic runtime files to a target directory.
 *
 * Usage:
 *   npx underscore-sdk ./public/supersonic
 *
 * Since the supersonic 0.6x split the runtime ships as two packages:
 * the MIT `supersonic-scsynth` (JS client + OSC workers) and the GPL
 * `supersonic-scsynth-core` (scsynth WASM + AudioWorklet). Core assets
 * are runtime-loaded by URL, never bundled (GPL license boundary), so
 * both packages' files must be served from the consumer's public dir:
 *
 *   <target>/wasm/     <- supersonic-scsynth-core/wasm/*
 *   <target>/workers/  <- supersonic-scsynth/dist/workers/* + supersonic-scsynth-core/workers/*
 *
 * That flat layout is what the SDK's `wasmBaseUrl` config expects
 * (coreBaseURL = wasmBaseUrl, workers under wasmBaseUrl + 'workers/').
 */

import { promises as fs } from "fs";
import { join, dirname } from "path";
import { createRequire } from "module";

export interface CopySupersonicAssetsDeps {
  /**
   * Injection seam for tests. Defaults to Node resolution from this
   * module's location (the installed bin inside the consumer tree).
   */
  resolvePackageDir?: (packageName: string) => string;
  log?: (message: string) => void;
}

async function copyDir(src: string, dest: string, log: (message: string) => void): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, log);
    } else {
      await fs.copyFile(srcPath, destPath);
      log(`  Copied: ${entry.name}`);
    }
  }
}

/*
 * Resolve package roots through Node resolution rather than hardcoded
 * node_modules paths: package managers hoist the two supersonic
 * packages to different levels depending on sibling version
 * constraints, so a fixed relative walk breaks silently. Resolution
 * starts from this bin's installed location, which by construction
 * sits inside the consumer's node_modules tree.
 */
export function resolvePackageDir(packageName: string): string {
  const require = createRequire(import.meta.url);
  try {
    return dirname(require.resolve(packageName));
  } catch {
    throw new Error(
      `Could not resolve ${packageName}. Make sure it is installed: ` +
        `npm install supersonic-scsynth supersonic-scsynth-core`
    );
  }
}

/**
 * Copy the dual-package supersonic runtime into `targetDir` as
 * `wasm/` + `workers/`. Exported so unit tests can pin the layout
 * without spawning the CLI.
 */
export async function copySupersonicAssets(
  targetDir: string,
  deps: CopySupersonicAssetsDeps = {}
): Promise<void> {
  const resolve = deps.resolvePackageDir ?? resolvePackageDir;
  const log = deps.log ?? ((message: string) => console.log(message));

  /*
   * supersonic-scsynth's main is dist/supersonic.js, so resolving the
   * module lands in dist/ directly; core's main is index.js at the
   * package root, which holds wasm/ and workers/ as siblings.
   */
  const supersonicDist = resolve("supersonic-scsynth");
  const coreRoot = resolve("supersonic-scsynth-core");
  log(`Found supersonic-scsynth at: ${supersonicDist}`);
  log(`Found supersonic-scsynth-core at: ${coreRoot}\n`);

  log("Copying WASM engine:");
  await copyDir(join(coreRoot, "wasm"), join(targetDir, "wasm"), log);

  log("\nCopying worker files:");
  await copyDir(join(supersonicDist, "workers"), join(targetDir, "workers"), log);
  await copyDir(join(coreRoot, "workers"), join(targetDir, "workers"), log);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
Underscore SDK - Copy WASM Assets

Usage:
  npx underscore-sdk <target-directory>

Example:
  npx underscore-sdk ./public/supersonic

This copies the supersonic runtime files (WASM engine, AudioWorklet,
OSC workers) from supersonic-scsynth and supersonic-scsynth-core to
your target directory. Your server must serve these files with the
correct MIME types.
`);
    process.exit(0);
  }

  const targetDir = args[0];

  console.log("Underscore SDK - Copying WASM assets...\n");

  try {
    await copySupersonicAssets(targetDir);
    console.log(`
Assets copied successfully to: ${targetDir}

Next steps:
1. Serve these files from your web server
2. Initialize the SDK with the matching wasmBaseUrl:

   const client = new Underscore({
     apiKey: 'us_...',
     wasmBaseUrl: '/supersonic/',  // or wherever you serve them
   });
`);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("copy-assets.js") || process.argv[1].endsWith("copy-assets.ts"));

if (isDirectRun) {
  main().catch((error) => {
    console.error("Fatal error:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
