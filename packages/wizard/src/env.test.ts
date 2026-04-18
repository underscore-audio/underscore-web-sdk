/**
 * Tests for the env file writer.
 *
 * Exercises three things that are easy to get wrong:
 *  1. Framework-specific prefix selection.
 *  2. Collision handling (never overwrite existing keys).
 *  3. Formatting (newline hygiene, preserving previous content).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envVarSpecs, parseEnvKeys, writeEnvDetailed } from "./env.js";
import type { DetectedProject } from "./types.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "underscore-wizard-env-"));
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

describe("envVarSpecs", () => {
  it("uses VITE_ prefix for vite frameworks", () => {
    const specs = envVarSpecs("vite-react", { publishableKey: "pk_test" });
    expect(specs).toEqual([
      expect.objectContaining({
        key: "VITE_UNDERSCORE_PUBLISHABLE_KEY",
        value: "pk_test",
        exposedToClient: true,
      }),
    ]);
  });

  it("uses NEXT_PUBLIC_ prefix for next frameworks", () => {
    const specs = envVarSpecs("next-app", { publishableKey: "pk_test" });
    expect(specs[0].key).toBe("NEXT_PUBLIC_UNDERSCORE_PUBLISHABLE_KEY");
  });

  it("uses bare UNDERSCORE_ for vanilla/unknown", () => {
    expect(envVarSpecs("vanilla-html", { publishableKey: "pk_test" })[0].key).toBe(
      "UNDERSCORE_PUBLISHABLE_KEY"
    );
    expect(envVarSpecs("unknown", { publishableKey: "pk_test" })[0].key).toBe(
      "UNDERSCORE_PUBLISHABLE_KEY"
    );
  });

  it("includes the secret key (unprefixed) when present", () => {
    const specs = envVarSpecs("next-app", { publishableKey: "pk_x", secretKey: "sk_x" });
    expect(specs.map((s) => s.key)).toEqual([
      "NEXT_PUBLIC_UNDERSCORE_PUBLISHABLE_KEY",
      "UNDERSCORE_SECRET_KEY",
    ]);
    expect(specs[1].exposedToClient).toBe(false);
  });
});

describe("parseEnvKeys", () => {
  it("extracts simple KEY=value pairs", () => {
    const keys = parseEnvKeys("FOO=bar\nBAZ=qux\n");
    expect(keys).toEqual(new Set(["FOO", "BAZ"]));
  });

  it("skips comments and blank lines", () => {
    const keys = parseEnvKeys("# a comment\n\nFOO=1\n# FOO=2\n");
    expect(keys).toEqual(new Set(["FOO"]));
  });

  it("handles the export prefix", () => {
    const keys = parseEnvKeys("export FOO=1\n");
    expect(keys).toEqual(new Set(["FOO"]));
  });

  it("ignores lowercase / weird left-hand sides", () => {
    const keys = parseEnvKeys("lowercase=1\n- weird\n");
    expect(keys).toEqual(new Set());
  });
});

describe("writeEnvDetailed", () => {
  it("creates the env file when missing", async () => {
    const result = await writeEnvDetailed(project(), { publishableKey: "pk_new" });
    const text = await fs.readFile(result.path, "utf8");
    expect(text).toContain("VITE_UNDERSCORE_PUBLISHABLE_KEY=pk_new");
    expect(text.endsWith("\n")).toBe(true);
    expect(result.added).toEqual(["VITE_UNDERSCORE_PUBLISHABLE_KEY"]);
    expect(result.existingKeysSkipped).toEqual([]);
  });

  it("appends to an existing file and preserves prior content", async () => {
    await fs.writeFile(join(root, ".env.local"), "OTHER=existing\n");
    const result = await writeEnvDetailed(project(), { publishableKey: "pk_new" });
    const text = await fs.readFile(result.path, "utf8");
    expect(text.startsWith("OTHER=existing")).toBe(true);
    expect(text).toContain("VITE_UNDERSCORE_PUBLISHABLE_KEY=pk_new");
    expect(result.added).toEqual(["VITE_UNDERSCORE_PUBLISHABLE_KEY"]);
  });

  it("skips existing keys rather than overwriting them", async () => {
    await fs.writeFile(
      join(root, ".env.local"),
      "VITE_UNDERSCORE_PUBLISHABLE_KEY=pk_old\n"
    );
    const result = await writeEnvDetailed(project(), { publishableKey: "pk_new" });
    const text = await fs.readFile(result.path, "utf8");
    expect(text).toContain("VITE_UNDERSCORE_PUBLISHABLE_KEY=pk_old");
    expect(text).not.toContain("pk_new");
    expect(result.added).toEqual([]);
    expect(result.existingKeysSkipped).toEqual(["VITE_UNDERSCORE_PUBLISHABLE_KEY"]);
  });

  it("writes both keys when secretKey is present and neither exists", async () => {
    const result = await writeEnvDetailed(project({ framework: "next-app" }), {
      publishableKey: "pk_1",
      secretKey: "sk_1",
    });
    const text = await fs.readFile(result.path, "utf8");
    expect(text).toContain("NEXT_PUBLIC_UNDERSCORE_PUBLISHABLE_KEY=pk_1");
    expect(text).toContain("UNDERSCORE_SECRET_KEY=sk_1");
    expect(result.added).toEqual([
      "NEXT_PUBLIC_UNDERSCORE_PUBLISHABLE_KEY",
      "UNDERSCORE_SECRET_KEY",
    ]);
  });

  it("includes the comment on first write", async () => {
    const result = await writeEnvDetailed(project(), { publishableKey: "pk_x" });
    const text = await fs.readFile(result.path, "utf8");
    expect(text).toMatch(/#.*Publishable key.*\n.*VITE_UNDERSCORE_PUBLISHABLE_KEY=pk_x/);
  });

  it("handles files that don't end with a newline", async () => {
    await fs.writeFile(join(root, ".env.local"), "OTHER=existing");
    await writeEnvDetailed(project(), { publishableKey: "pk_new" });
    const text = await fs.readFile(join(root, ".env.local"), "utf8");
    expect(text).toContain("OTHER=existing\n");
    expect(text).toContain("VITE_UNDERSCORE_PUBLISHABLE_KEY=pk_new");
  });
});
