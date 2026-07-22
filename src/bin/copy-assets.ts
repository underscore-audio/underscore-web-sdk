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

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
      console.log(`  Copied: ${entry.name}`);
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
function resolvePackageDir(packageName: string): string {
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
    /*
     * supersonic-scsynth's main is dist/supersonic.js, so resolving the
     * module lands in dist/ directly; core's main is index.js at the
     * package root, which holds wasm/ and workers/ as siblings.
     */
    const supersonicDist = resolvePackageDir("supersonic-scsynth");
    const coreRoot = resolvePackageDir("supersonic-scsynth-core");
    console.log(`Found supersonic-scsynth at: ${supersonicDist}`);
    console.log(`Found supersonic-scsynth-core at: ${coreRoot}\n`);

    console.log("Copying WASM engine:");
    await copyDir(join(coreRoot, "wasm"), join(targetDir, "wasm"));

    console.log("\nCopying worker files:");
    await copyDir(join(supersonicDist, "workers"), join(targetDir, "workers"));
    await copyDir(join(coreRoot, "workers"), join(targetDir, "workers"));

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

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
