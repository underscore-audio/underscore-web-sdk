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

describe("installDependencies", () => {
  it.each([
    ["npm", "npm", ["install", "@underscore-audio/sdk", "supersonic-scsynth@^0.14.0"]],
    ["pnpm", "pnpm", ["add", "@underscore-audio/sdk", "supersonic-scsynth@^0.14.0"]],
    ["yarn", "yarn", ["add", "@underscore-audio/sdk", "supersonic-scsynth@^0.14.0"]],
    ["bun", "bun", ["add", "@underscore-audio/sdk", "supersonic-scsynth@^0.14.0"]],
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
      ["add", "/tmp/tarballs/underscore-sdk-0.1.0.tgz", "supersonic-scsynth@^0.14.0"],
      { cwd: "/tmp/app" }
    );
  });

  it("matches tarballOverrides keys by bare package name, ignoring version specifier", async () => {
    const run = vi.fn(async () => {});
    await installDependencies(
      project({ packageManager: "npm" }),
      options({
        tarballOverrides: {
          "supersonic-scsynth": "/tmp/tarballs/supersonic-scsynth-0.14.0.tgz",
        },
      }),
      { run }
    );
    expect(run).toHaveBeenCalledWith(
      "npm",
      ["install", "@underscore-audio/sdk", "/tmp/tarballs/supersonic-scsynth-0.14.0.tgz"],
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
