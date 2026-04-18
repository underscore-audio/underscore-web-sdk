/**
 * Tests for the scaffold module.
 *
 * The scaffolded contents are inspected but we deliberately don't snapshot
 * them -- snapshots would fight the natural evolution of the template.
 * Instead we pin specific invariants: imports, env var names, and the
 * chosen compositionId/synthName flowing through to the demo source.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scaffoldFilesDetailed,
  wrapperPath,
  demoPath,
  wrapperSource,
  demoSource,
} from "./scaffold.js";
import type { DetectedProject } from "./types.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "underscore-wizard-scaffold-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function project(overrides: Partial<DetectedProject> = {}): DetectedProject {
  return {
    root,
    framework: "vite-react",
    packageManager: "npm",
    publicDir: "public",
    envFile: ".env.local",
    configFile: "vite.config.ts",
    entryFile: "src/main.tsx",
    ...overrides,
  };
}

describe("wrapperPath / demoPath", () => {
  it("maps each supported framework to the expected locations", () => {
    expect(wrapperPath("vite-react")).toBe("src/underscore.ts");
    expect(demoPath("vite-react")).toBe("src/UnderscoreDemo.tsx");

    expect(wrapperPath("next-app")).toBe("lib/underscore.ts");
    expect(demoPath("next-app")).toBe("components/UnderscoreDemo.tsx");

    expect(wrapperPath("vanilla-html")).toBe("underscore.js");
    expect(demoPath("vanilla-html")).toBe("underscore-demo.html");
  });

  it("returns null for unknown framework", () => {
    expect(wrapperPath("unknown")).toBeNull();
    expect(demoPath("unknown")).toBeNull();
  });
});

describe("wrapperSource", () => {
  it("uses import.meta.env for Vite frameworks", () => {
    const src = wrapperSource("vite-react");
    expect(src).toContain("import.meta.env.VITE_UNDERSCORE_PUBLISHABLE_KEY");
    expect(src).toContain('import { Underscore } from "@underscore-audio/sdk"');
  });

  it("uses process.env.NEXT_PUBLIC_ for Next", () => {
    const src = wrapperSource("next-app");
    expect(src).toContain("process.env.NEXT_PUBLIC_UNDERSCORE_PUBLISHABLE_KEY");
  });

  it("has a fallback branch for vanilla-html", () => {
    const src = wrapperSource("vanilla-html");
    expect(src).toContain("UNDERSCORE_PUBLISHABLE_KEY");
  });
});

describe("demoSource", () => {
  it("embeds the chosen compositionId and synthName", () => {
    const src = demoSource("vite-react", "cmp_abc", "lead_v2");
    expect(src).toContain('"cmp_abc"');
    expect(src).toContain('"lead_v2"');
  });

  it("next-app demo uses the 'use client' directive", () => {
    const src = demoSource("next-app", "cmp_x", "pad");
    expect(src.startsWith('"use client";')).toBe(true);
  });

  it("next-pages demo does not emit the 'use client' directive", () => {
    const src = demoSource("next-pages", "cmp_x", "pad");
    expect(src.startsWith('"use client";')).toBe(false);
  });

  it("vue demo contains a <script setup> block", () => {
    expect(demoSource("vite-vue", "cmp_x", "pad")).toContain("<script setup");
  });

  it("svelte demo contains a <script lang='ts'> block", () => {
    expect(demoSource("vite-svelte", "cmp_x", "pad")).toContain('<script lang="ts">');
  });
});

describe("scaffoldFilesDetailed", () => {
  it("writes wrapper and demo for Vite React", async () => {
    const result = await scaffoldFilesDetailed(project(), [
      { id: "cmp_1", title: "A", tags: [], previewSynthName: "pad_v1" },
    ]);
    expect(result.written).toEqual(
      expect.arrayContaining(["src/underscore.ts", "src/UnderscoreDemo.tsx"])
    );
    expect(result.skipped).toEqual([]);

    const demo = await fs.readFile(join(root, "src/UnderscoreDemo.tsx"), "utf8");
    expect(demo).toContain('"cmp_1"');
    expect(demo).toContain('"pad_v1"');
  });

  it("skips files that already exist and reports them", async () => {
    await fs.mkdir(join(root, "src"), { recursive: true });
    await fs.writeFile(join(root, "src/underscore.ts"), "// user-owned content\n");

    const result = await scaffoldFilesDetailed(project(), []);
    expect(result.skipped).toContain("src/underscore.ts");
    expect(result.written).toContain("src/UnderscoreDemo.tsx");

    const wrapper = await fs.readFile(join(root, "src/underscore.ts"), "utf8");
    expect(wrapper).toBe("// user-owned content\n");
  });

  it("falls back to defaults when compositions is empty", async () => {
    const result = await scaffoldFilesDetailed(project({ framework: "vite-vanilla" }), []);
    expect(result.written).toContain("src/underscore-demo.ts");

    const demo = await fs.readFile(join(root, "src/underscore-demo.ts"), "utf8");
    expect(demo).toContain('"cmp_starter"');
    expect(demo).toContain('"starter"');
  });

  it("writes nothing for unknown framework", async () => {
    const result = await scaffoldFilesDetailed(
      project({ framework: "unknown", configFile: null }),
      []
    );
    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("creates parent directories as needed", async () => {
    const result = await scaffoldFilesDetailed(project({ framework: "next-app" }), []);
    expect(result.written).toEqual(
      expect.arrayContaining(["lib/underscore.ts", "components/UnderscoreDemo.tsx"])
    );
  });
});
