/**
 * Tests for project detection.
 *
 * These tests build up small fixture projects in a real tmp directory rather
 * than mocking node:fs. Two reasons:
 *  - The code under test reads package.json, lockfiles, and directories; a
 *    real fs is a more honest test surface than a partial fs mock.
 *  - The fixtures are cheap to create and automatically cleaned up by
 *    vitest's per-test afterEach hooks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectProject,
  detectFramework,
  detectPackageManager,
  defaultEnvFile,
  hasDependency,
} from "./detect.js";

let root: string;

async function writePkg(overrides: Record<string, unknown> = {}): Promise<void> {
  await fs.writeFile(join(root, "package.json"), JSON.stringify({ name: "fx", ...overrides }));
}

async function touch(relPath: string, contents = ""): Promise<void> {
  const full = join(root, relPath);
  await fs.mkdir(join(full, ".."), { recursive: true });
  await fs.writeFile(full, contents);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "underscore-wizard-detect-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("detectPackageManager", () => {
  it("prefers the packageManager field (Corepack)", async () => {
    const pm = await detectPackageManager(root, { packageManager: "pnpm@9.1.0" });
    expect(pm).toBe("pnpm");
  });

  it("falls back to pnpm-lock.yaml when no Corepack field is set", async () => {
    await touch("pnpm-lock.yaml");
    const pm = await detectPackageManager(root, null);
    expect(pm).toBe("pnpm");
  });

  it("falls back to yarn.lock", async () => {
    await touch("yarn.lock");
    const pm = await detectPackageManager(root, null);
    expect(pm).toBe("yarn");
  });

  it("falls back to bun.lockb", async () => {
    await touch("bun.lockb");
    const pm = await detectPackageManager(root, null);
    expect(pm).toBe("bun");
  });

  it("defaults to npm when no lockfile is present", async () => {
    expect(await detectPackageManager(root, null)).toBe("npm");
  });

  it("ignores an unknown packageManager value", async () => {
    const pm = await detectPackageManager(root, { packageManager: "weird@1.0.0" });
    expect(pm).toBe("npm");
  });
});

describe("hasDependency", () => {
  it("returns true across deps/devDeps/peerDeps", () => {
    expect(hasDependency({ dependencies: { react: "19.0.0" } }, "react")).toBe(true);
    expect(hasDependency({ devDependencies: { vite: "5.0.0" } }, "vite")).toBe(true);
    expect(hasDependency({ peerDependencies: { react: "*" } }, "react")).toBe(true);
  });

  it("returns false for missing deps", () => {
    expect(hasDependency({}, "react")).toBe(false);
    expect(hasDependency(null, "react")).toBe(false);
  });
});

describe("detectFramework", () => {
  it("detects Next.js app router when only app/ exists", async () => {
    await touch("app/page.tsx");
    await touch("next.config.mjs");
    const result = await detectFramework(root, { dependencies: { next: "15.0.0" } });
    expect(result.framework).toBe("next-app");
    expect(result.configFile).toBe("next.config.mjs");
    expect(result.publicDir).toBe("public");
  });

  it("detects Next.js pages router when pages/ exists", async () => {
    await touch("pages/index.tsx");
    const result = await detectFramework(root, { dependencies: { next: "14.2.0" } });
    expect(result.framework).toBe("next-pages");
  });

  it("treats mixed app/ + pages/ as pages router (legacy fallback)", async () => {
    await touch("app/page.tsx");
    await touch("pages/index.tsx");
    const result = await detectFramework(root, { dependencies: { next: "14.2.0" } });
    expect(result.framework).toBe("next-pages");
  });

  it("detects Vite React", async () => {
    await touch("vite.config.ts");
    await touch("src/main.tsx");
    const result = await detectFramework(root, {
      devDependencies: { vite: "5.0.0" },
      dependencies: { react: "18.2.0" },
    });
    expect(result.framework).toBe("vite-react");
    expect(result.configFile).toBe("vite.config.ts");
    expect(result.entryFile).toBe("src/main.tsx");
  });

  it("detects Vite vanilla when there's no framework dep", async () => {
    await touch("vite.config.js");
    await touch("src/main.ts");
    const result = await detectFramework(root, { devDependencies: { vite: "5.0.0" } });
    expect(result.framework).toBe("vite-vanilla");
  });

  it("detects Vite Vue and Svelte", async () => {
    await touch("vite.config.ts");
    const vueResult = await detectFramework(root, {
      devDependencies: { vite: "5.0.0" },
      dependencies: { vue: "3.4.0" },
    });
    expect(vueResult.framework).toBe("vite-vue");

    const svelteResult = await detectFramework(root, {
      devDependencies: { vite: "5.0.0" },
      dependencies: { svelte: "4.2.0" },
    });
    expect(svelteResult.framework).toBe("vite-svelte");
  });

  it("prefers Next.js over Vite when both deps exist (Next uses Vite for nothing)", async () => {
    await touch("app/page.tsx");
    const result = await detectFramework(root, {
      dependencies: { next: "15.0.0", react: "19.0.0" },
      devDependencies: { vite: "5.0.0" },
    });
    expect(result.framework).toBe("next-app");
  });

  it("detects vanilla HTML when there's an index.html and no framework", async () => {
    await touch("index.html", "<html></html>");
    const result = await detectFramework(root, null);
    expect(result.framework).toBe("vanilla-html");
    expect(result.publicDir).toBe(".");
    expect(result.entryFile).toBe("index.html");
  });

  it("returns unknown when nothing matches", async () => {
    const result = await detectFramework(root, { dependencies: { lodash: "4.17.0" } });
    expect(result.framework).toBe("unknown");
  });
});

describe("defaultEnvFile", () => {
  it(".env.local for bundled frameworks", () => {
    expect(defaultEnvFile("vite-react")).toBe(".env.local");
    expect(defaultEnvFile("next-app")).toBe(".env.local");
  });

  it(".env for vanilla/unknown", () => {
    expect(defaultEnvFile("vanilla-html")).toBe(".env");
    expect(defaultEnvFile("unknown")).toBe(".env");
  });
});

describe("detectProject", () => {
  const baseOptions = {
    apiBaseUrl: "https://api.test",
    webBaseUrl: "https://web.test",
    nonInteractive: false,
    skipInstall: false,
    skipScaffold: false,
  };

  it("returns a fully populated DetectedProject for a Vite React repo", async () => {
    await writePkg({
      dependencies: { react: "18.2.0" },
      devDependencies: { vite: "5.0.0" },
      packageManager: "pnpm@9.0.0",
    });
    await touch("vite.config.ts");
    await touch("src/main.tsx");

    const project = await detectProject({ ...baseOptions, cwd: root });

    expect(project).toMatchObject({
      root,
      framework: "vite-react",
      packageManager: "pnpm",
      publicDir: "public",
      envFile: ".env.local",
      configFile: "vite.config.ts",
      entryFile: "src/main.tsx",
    });
  });

  it("works with no package.json (pure HTML project)", async () => {
    await touch("index.html");
    const project = await detectProject({ ...baseOptions, cwd: root });
    expect(project.framework).toBe("vanilla-html");
    expect(project.packageManager).toBe("npm");
    expect(project.envFile).toBe(".env");
  });
});
