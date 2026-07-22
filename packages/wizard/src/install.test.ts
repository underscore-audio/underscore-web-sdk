/**
 * Tests for the install phase.
 *
 * Runtime execution is stubbed out via the `run` injection seam; we only
 * assert that the right command is chosen for the detected package manager
 * and that the WASM copy targets the right directory.
 */

import { describe, it, expect, vi } from "vitest";
import { installDependencies, copyWasmAssets } from "./install.js";
import type { DetectedProject, WizardOptions } from "./types.js";

function project(overrides: Partial<DetectedProject> = {}): DetectedProject {
  return {
    root: "/tmp/app",
    framework: "vite-react",
    packageManager: "npm",
    publicDir: "public",
    envFile: ".env.local",
    configFile: "vite.config.ts",
    entryFile: "src/main.tsx",
    ...overrides,
  };
}

function options(overrides: Partial<WizardOptions> = {}): WizardOptions {
  return {
    cwd: "/tmp/app",
    apiBaseUrl: "http://api.test",
    webBaseUrl: "http://web.test",
    nonInteractive: true,
    skipInstall: false,
    skipScaffold: false,
    ...overrides,
  };
}

const SUPERSONIC_SPEC = "supersonic-scsynth@>=0.70.0 <1.0.0";
const SUPERSONIC_CORE_SPEC = "supersonic-scsynth-core@>=0.70.0 <1.0.0";

describe("installDependencies", () => {
  it.each([
    ["npm", "npm", ["install", "@underscore-audio/sdk", SUPERSONIC_SPEC, SUPERSONIC_CORE_SPEC]],
    ["pnpm", "pnpm", ["add", "@underscore-audio/sdk", SUPERSONIC_SPEC, SUPERSONIC_CORE_SPEC]],
    ["yarn", "yarn", ["add", "@underscore-audio/sdk", SUPERSONIC_SPEC, SUPERSONIC_CORE_SPEC]],
    ["bun", "bun", ["add", "@underscore-audio/sdk", SUPERSONIC_SPEC, SUPERSONIC_CORE_SPEC]],
  ] as const)("runs %s with the right args", async (pm, expectedCmd, expectedArgs) => {
    const run = vi.fn(async () => {});
    await installDependencies(project({ packageManager: pm }), options(), { run });
    expect(run).toHaveBeenCalledWith(expectedCmd, expectedArgs, { cwd: "/tmp/app" });
  });

  it("wraps install errors with context", async () => {
    const run = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    await expect(installDependencies(project(), options(), { run })).rejects.toThrow(
      /npm install .* failed in \/tmp\/app/
    );
  });

  it("substitutes registry names for tarball paths when tarballOverrides is set", async () => {
    const run = vi.fn(async () => {});
    await installDependencies(
      project({ packageManager: "npm" }),
      options({
        tarballOverrides: {
          "@underscore-audio/sdk": "/tmp/tarballs/underscore-sdk-0.1.0.tgz",
          "supersonic-scsynth": "/tmp/tarballs/supersonic-scsynth-1.2.3.tgz",
          "supersonic-scsynth-core": "/tmp/tarballs/supersonic-scsynth-core-1.2.3.tgz",
        },
      }),
      { run }
    );
    expect(run).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "/tmp/tarballs/underscore-sdk-0.1.0.tgz",
        "/tmp/tarballs/supersonic-scsynth-1.2.3.tgz",
        "/tmp/tarballs/supersonic-scsynth-core-1.2.3.tgz",
      ],
      { cwd: "/tmp/app" }
    );
  });

  it("falls back to the registry name for packages not in the override map", async () => {
    const run = vi.fn(async () => {});
    await installDependencies(
      project({ packageManager: "pnpm" }),
      options({
        tarballOverrides: {
          "@underscore-audio/sdk": "/tmp/tarballs/underscore-sdk-0.1.0.tgz",
        },
      }),
      { run }
    );
    expect(run).toHaveBeenCalledWith(
      "pnpm",
      ["add", "/tmp/tarballs/underscore-sdk-0.1.0.tgz", SUPERSONIC_SPEC, SUPERSONIC_CORE_SPEC],
      { cwd: "/tmp/app" }
    );
  });

  it("matches tarballOverrides keys by bare package name, ignoring version specifier", async () => {
    /*
     * The core override key is a strict prefix-extension of the
     * supersonic-scsynth key, so this test also pins that the bare-name
     * lookup is exact-match: the supersonic-scsynth tarball must not
     * be substituted for supersonic-scsynth-core or vice versa.
     */
    const run = vi.fn(async () => {});
    await installDependencies(
      project({ packageManager: "npm" }),
      options({
        tarballOverrides: {
          "supersonic-scsynth": "/tmp/tarballs/supersonic-scsynth-0.70.0.tgz",
        },
      }),
      { run }
    );
    expect(run).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "@underscore-audio/sdk",
        "/tmp/tarballs/supersonic-scsynth-0.70.0.tgz",
        SUPERSONIC_CORE_SPEC,
      ],
      { cwd: "/tmp/app" }
    );
  });
});

describe("copyWasmAssets", () => {
  it("calls `npx underscore-sdk <publicDir>/supersonic`", async () => {
    const run = vi.fn(async () => {});
    const written = await copyWasmAssets(project({ publicDir: "public" }), { run });
    expect(run).toHaveBeenCalledWith("npx", ["underscore-sdk", "public/supersonic"], {
      cwd: "/tmp/app",
    });
    expect(written).toEqual(["public/supersonic"]);
  });

  it("uses the project's custom public dir", async () => {
    const run = vi.fn(async () => {});
    await copyWasmAssets(project({ publicDir: "." }), { run });
    expect(run).toHaveBeenCalledWith("npx", ["underscore-sdk", "supersonic"], {
      cwd: "/tmp/app",
    });
  });

  it("wraps errors with context", async () => {
    const run = vi.fn(async () => {
      throw new Error("bad bin");
    });
    await expect(copyWasmAssets(project(), { run })).rejects.toThrow(
      /underscore-sdk copy failed/
    );
  });
});
