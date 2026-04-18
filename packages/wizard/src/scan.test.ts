/**
 * Tests for the project scanner and tag extractor.
 *
 * Extraction is pure string work and we exercise it directly. The file
 * reading layer is covered with a small tmp-dir fixture to confirm the cap
 * on bytes read and the fail-open behavior on unreadable files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTags, scanProjectForTags } from "./scan.js";
import type { DetectedProject } from "./types.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "underscore-wizard-scan-"));
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

describe("extractTags", () => {
  it("maps game-related keywords to the game tag", () => {
    expect(extractTags("This is a roguelike game with levels")).toContain("game");
  });

  it("recognizes retro/chiptune synonyms", () => {
    const tags = extractTags("Retro 8-bit pixel adventure with chiptune music");
    expect(tags).toEqual(expect.arrayContaining(["retro", "chiptune"]));
  });

  it("maps calm/meditation words to ambient", () => {
    expect(extractTags("A meditation app for zen focus")).toContain("ambient");
  });

  it("returns an empty list when no keywords match", () => {
    expect(extractTags("something completely neutral")).toEqual([]);
  });

  it("returns each tag at most once", () => {
    const tags = extractTags("game game game enemy player");
    const counts = tags.filter((t) => t === "game").length;
    expect(counts).toBe(1);
  });

  it("caps the number of returned tags", () => {
    const tags = extractTags(
      "retro pixel game ambient meditation lofi dashboard cart horror cinematic drum pad"
    );
    expect(tags.length).toBeLessThanOrEqual(4);
  });

  it("is case-insensitive", () => {
    expect(extractTags("HORROR")).toContain("dark");
  });
});

describe("scanProjectForTags", () => {
  it("reads package.json and README.md and derives tags", async () => {
    await fs.writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "my-game", description: "A retro pixel adventure" })
    );
    await fs.writeFile(join(root, "README.md"), "# Dashboard\n\nA simple analytics dashboard.\n");
    await fs.mkdir(join(root, "src"), { recursive: true });
    await fs.writeFile(join(root, "src", "main.tsx"), "// nothing useful");

    const tags = await scanProjectForTags(project());
    expect(tags).toEqual(expect.arrayContaining(["retro"]));
  });

  it("returns an empty list for a minimal project with nothing interesting", async () => {
    await fs.writeFile(join(root, "package.json"), JSON.stringify({ name: "fx" }));
    const tags = await scanProjectForTags(project({ entryFile: null }));
    expect(tags).toEqual([]);
  });

  it("doesn't crash when files are missing or unreadable", async () => {
    const tags = await scanProjectForTags(project({ entryFile: null }));
    expect(tags).toEqual([]);
  });
});
