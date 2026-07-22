/**
 * Layout contract for `copySupersonicAssets`.
 *
 * The dual-package resolve + merged workers/ tree is the riskiest
 * boundary after the 0.6x split: wrong package roots, missing wasm/,
 * or a workers/ overwrite that drops one side all produce silent
 * runtime failures in the consumer. Pin the produced tree against a
 * fixture node_modules layout without touching the real registry.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { copySupersonicAssets, resolvePackageDir, isEntryModule } from "./copy-assets.js";

describe("copySupersonicAssets", () => {
  let fixtureRoot: string;
  let targetDir: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "copy-assets-fixture-"));
    targetDir = join(fixtureRoot, "public", "supersonic");

    const clientDist = join(fixtureRoot, "supersonic-scsynth", "dist");
    const coreRoot = join(fixtureRoot, "supersonic-scsynth-core");
    mkdirSync(join(clientDist, "workers"), { recursive: true });
    mkdirSync(join(coreRoot, "wasm"), { recursive: true });
    mkdirSync(join(coreRoot, "workers"), { recursive: true });

    writeFileSync(join(clientDist, "workers", "osc_in_worker.js"), "// osc");
    writeFileSync(join(coreRoot, "wasm", "scsynth-nrt.wasm"), "wasm-bytes");
    writeFileSync(join(coreRoot, "workers", "scsynth_audio_worklet.js"), "// worklet");
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("copies wasm/ from core and merges both packages' workers/", async () => {
    const clientDist = join(fixtureRoot, "supersonic-scsynth", "dist");
    const coreRoot = join(fixtureRoot, "supersonic-scsynth-core");

    await copySupersonicAssets(targetDir, {
      resolvePackageDir: (name) => {
        if (name === "supersonic-scsynth") return clientDist;
        if (name === "supersonic-scsynth-core") return coreRoot;
        throw new Error(`unexpected package ${name}`);
      },
      log: () => {},
    });

    expect(readFileSync(join(targetDir, "wasm", "scsynth-nrt.wasm"), "utf8")).toBe("wasm-bytes");
    expect(readdirSync(join(targetDir, "workers")).sort()).toEqual([
      "osc_in_worker.js",
      "scsynth_audio_worklet.js",
    ]);
    expect(readFileSync(join(targetDir, "workers", "osc_in_worker.js"), "utf8")).toBe("// osc");
    expect(readFileSync(join(targetDir, "workers", "scsynth_audio_worklet.js"), "utf8")).toBe(
      "// worklet"
    );
  });

  it("surfaces a clear error when a peer package cannot be resolved", async () => {
    await expect(
      copySupersonicAssets(targetDir, {
        resolvePackageDir: () => {
          throw new Error(
            "Could not resolve supersonic-scsynth-core. Make sure it is installed: " +
              "npm install supersonic-scsynth supersonic-scsynth-core"
          );
        },
        log: () => {},
      })
    ).rejects.toThrow(/supersonic-scsynth-core/);
  });
});

describe("isEntryModule", () => {
  const moduleUrl = pathToFileURL("/pkg/dist/bin/copy-assets.js").href;
  const modulePath = "/pkg/dist/bin/copy-assets.js";

  it("detects the installed bin invoked via its .bin symlink", () => {
    /*
     * Reproduces the real regression: argv[1] is the .bin symlink path,
     * which realpath collapses onto this module. A filename-suffix guard
     * missed this and left main() unreached, so the copy silently no-oped.
     */
    const binSymlink = "/consumer/node_modules/.bin/underscore-sdk";
    const resolveReal = (p: string) => (p === binSymlink ? modulePath : p);
    expect(isEntryModule(binSymlink, moduleUrl, resolveReal)).toBe(true);
  });

  it("detects a direct `node copy-assets.js` run", () => {
    expect(isEntryModule(modulePath, moduleUrl, (p) => p)).toBe(true);
  });

  it("returns false when imported as a library (different entry point)", () => {
    const importer = "/consumer/build/app.js";
    expect(isEntryModule(importer, moduleUrl, (p) => p)).toBe(false);
  });

  it("returns false when argv[1] is undefined", () => {
    expect(isEntryModule(undefined, moduleUrl, (p) => p)).toBe(false);
  });

  it("returns false when the entry path cannot be resolved", () => {
    expect(
      isEntryModule("/missing", moduleUrl, () => {
        throw new Error("ENOENT");
      })
    ).toBe(false);
  });
});

describe("resolvePackageDir", () => {
  it("resolves an installed package from this module's node_modules tree", () => {
    /*
     * The SDK checkout installs both peers as devDependencies, so the
     * real resolver must succeed here. This is the smoke check that
     * the createRequire(import.meta.url) path still lands inside a
     * real package root rather than a dangling relative walk.
     */
    const dir = resolvePackageDir("supersonic-scsynth");
    expect(dir).toContain("supersonic-scsynth");
  });
});
