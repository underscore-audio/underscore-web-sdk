#!/usr/bin/env node
/*
 * Copy the SDK's supersonic peerDependencies into dist/sdk-peers.json
 * so a published wizard still knows which ranges to install when the
 * monorepo package.json is not on disk beside it.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sdkPkgPath = join(here, "../../../package.json");
const outPath = join(here, "../dist/sdk-peers.json");

const sdkPkg = JSON.parse(readFileSync(sdkPkgPath, "utf8"));
if (sdkPkg.name !== "@underscore-audio/sdk") {
  throw new Error(`Expected SDK package at ${sdkPkgPath}, got ${sdkPkg.name}`);
}

const peers = {
  "supersonic-scsynth": sdkPkg.peerDependencies?.["supersonic-scsynth"],
  "supersonic-scsynth-core": sdkPkg.peerDependencies?.["supersonic-scsynth-core"],
};
for (const [name, range] of Object.entries(peers)) {
  if (typeof range !== "string") {
    throw new Error(`SDK package.json missing peerDependency ${name}`);
  }
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(peers, null, 2)}\n`);
console.log(`baked ${outPath}`);
