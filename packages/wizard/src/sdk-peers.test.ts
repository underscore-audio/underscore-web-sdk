/**
 * Drift guard: the wizard's install specs must track the SDK's
 * peerDependencies. Without this, a peer bump in package.json that
 * forgets to re-bake (or that the monorepo reader fails to see) would
 * ship a wizard that installs ranges the SDK no longer claims.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUPERSONIC_PEER_NAMES,
  loadSupersonicPeerRanges,
  sdkInstallPackages,
} from "./sdk-peers.js";

describe("sdk-peers", () => {
  it("matches the SDK package.json peerDependencies exactly", () => {
    const sdkPkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json");
    const sdkPkg = JSON.parse(readFileSync(sdkPkgPath, "utf8")) as {
      peerDependencies: Record<string, string>;
    };

    const ranges = loadSupersonicPeerRanges();
    for (const name of SUPERSONIC_PEER_NAMES) {
      expect(ranges[name]).toBe(sdkPkg.peerDependencies[name]);
    }
  });

  it("builds install specs as sdk + each peer@range", () => {
    const ranges = loadSupersonicPeerRanges();
    expect(sdkInstallPackages()).toEqual([
      "@underscore-audio/sdk",
      ...SUPERSONIC_PEER_NAMES.map((name) => `${name}@${ranges[name]}`),
    ]);
  });
});
