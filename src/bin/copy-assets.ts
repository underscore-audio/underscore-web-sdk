#!/usr/bin/env node
/**
 * CLI tool to copy supersonic-scsynth WASM and worker files to a target directory.
 *
 * Usage:
 *   npx @underscore-audio/sdk copy-assets ./public/supersonic
 *
 * This copies the necessary files from supersonic-scsynth to your public directory
 * so they can be served alongside your application.
 */

import { promises as fs } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

async function findSupersonicDist(): Promise<string> {
  const possiblePaths = [
    join(__dirname, "../../node_modules/supersonic-scsynth/dist"),
    join(__dirname, "../../../node_modules/supersonic-scsynth/dist"),
    join(__dirname, "../../../../node_modules/supersonic-scsynth/dist"),
    join(process.cwd(), "node_modules/supersonic-scsynth/dist"),
  ];

  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // Continue to next path
    }
  }

  throw new Error(
    "Could not find supersonic-scsynth dist directory. " +
      "Make sure supersonic-scsynth is installed."
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
Underscore SDK - Copy WASM Assets

Usage:
  npx @underscore-audio/sdk copy-assets <target-directory>

Example:
  npx @underscore-audio/sdk copy-assets ./public/supersonic

This copies the supersonic-scsynth WASM and worker files to your target directory.
Your server must serve these files with the correct MIME types and CORS headers.

Required headers:
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
`);
    process.exit(0);
  }

  const targetDir = args[0];

  console.log("Underscore SDK - Copying WASM assets...\n");

  try {
    const supersonicDist = await findSupersonicDist();
    console.log(`Found supersonic-scsynth at: ${supersonicDist}\n`);

    // Copy wasm files
    const wasmSrc = join(supersonicDist, "wasm");
    const wasmDest = join(targetDir, "wasm");
    console.log("Copying WASM files:");
    await copyDir(wasmSrc, wasmDest);

    // Copy worker files
    const workersSrc = join(supersonicDist, "workers");
    const workersDest = join(targetDir, "workers");
    console.log("\nCopying worker files:");
    await copyDir(workersSrc, workersDest);

    console.log(`
Assets copied successfully to: ${targetDir}

Next steps:
1. Serve these files from your web server
2. Ensure the server sets the required headers:
   - Cross-Origin-Opener-Policy: same-origin
   - Cross-Origin-Embedder-Policy: require-corp
3. Initialize the SDK with the correct wasmBaseUrl:

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
