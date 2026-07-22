/**
 * Single source of truth for the supersonic peer ranges the wizard
 * installs alongside `@underscore-audio/sdk`.
 *
 * Canonical ranges live in the SDK root `package.json`
 * `peerDependencies`. This module reads them at runtime from the
 * monorepo checkout, and from a baked `sdk-peers.json` next to the
 * compiled output when the wizard is published to npm (where the SDK
 * package.json is not on disk beside us).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SUPERSONIC_PEER_NAMES = [
  "supersonic-scsynth",
  "supersonic-scsynth-core",
] as const;

export type SupersonicPeerName = (typeof SUPERSONIC_PEER_NAMES)[number];

interface SdkPackageJson {
  name?: string;
  peerDependencies?: Record<string, string>;
}

function peerSourcePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  /*
   * Prefer the monorepo SDK package.json so local wizard builds always
   * track the canonical peers without a bake step. From
   * packages/wizard/{src,dist} that is three levels up.
   */
  const monorepoSdkPkg = join(here, "../../../package.json");
  if (existsSync(monorepoSdkPkg)) {
    const pkg = JSON.parse(readFileSync(monorepoSdkPkg, "utf8")) as SdkPackageJson;
    if (pkg.name === "@underscore-audio/sdk") {
      return monorepoSdkPkg;
    }
  }

  const baked = join(here, "sdk-peers.json");
  if (existsSync(baked)) {
    return baked;
  }

  throw new Error(
    "Could not locate SDK peerDependencies. Expected the monorepo " +
      "underscore-web-sdk/package.json or a baked sdk-peers.json next to " +
      "the wizard install module."
  );
}

/**
 * Returns the supersonic peer ranges declared by the SDK.
 * Used by install.ts and by the drift test that keeps the published
 * bake file honest.
 */
export function loadSupersonicPeerRanges(): Record<SupersonicPeerName, string> {
  const path = peerSourcePath();
  const raw = JSON.parse(readFileSync(path, "utf8")) as SdkPackageJson &
    Partial<Record<SupersonicPeerName, string>>;
  const peers = raw.peerDependencies ?? raw;
  const out = {} as Record<SupersonicPeerName, string>;
  for (const name of SUPERSONIC_PEER_NAMES) {
    const range = peers[name];
    if (typeof range !== "string" || range.length === 0) {
      throw new Error(`SDK peerDependencies missing ${name} (source: ${path})`);
    }
    out[name] = range;
  }
  return out;
}

/**
 * Package specs passed to the consumer's package manager: the SDK
 * plus each supersonic peer pinned to the SDK's declared range.
 */
export function sdkInstallPackages(): string[] {
  const ranges = loadSupersonicPeerRanges();
  return [
    "@underscore-audio/sdk",
    ...SUPERSONIC_PEER_NAMES.map((name) => `${name}@${ranges[name]}`),
  ];
}
