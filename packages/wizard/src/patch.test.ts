/**
 * Tests for the config patcher.
 *
 * Like detect.test.ts we use a real tmp directory rather than memfs since
 * magicast reads files directly. The fixture configs exercise the cases we
 * care about:
 *   - minimal defineConfig() call with no server/optimizeDeps
 *   - defineConfig() that already sets one of the fields
 *   - plain object export (no defineConfig wrapper)
 *   - config file we cannot safely parse -> manual fallback
 *   - next config that already has COOP headers
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchViteConfig, patchNextConfig, patchConfigDetailed } from "./patch.js";
import type { DetectedProject } from "./types.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "underscore-wizard-patch-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeFile(rel: string, contents: string): Promise<string> {
  const abs = join(root, rel);
  await fs.writeFile(abs, contents, "utf8");
  return abs;
}

function project(overrides: Partial<DetectedProject>): DetectedProject {
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

describe("patchViteConfig", () => {
  it("patches a minimal defineConfig() call", async () => {
    const abs = await writeFile(
      "vite.config.ts",
      `import { defineConfig } from "vite";\nexport default defineConfig({});\n`
    );

    const result = await patchViteConfig(abs, "vite.config.ts");
    expect(result.status).toBe("patched");

    const after = await fs.readFile(abs, "utf8");
    expect(after).toContain("Cross-Origin-Opener-Policy");
    expect(after).toContain("Cross-Origin-Embedder-Policy");
    expect(after).toContain("supersonic-scsynth");
    /*
     * Both server and preview blocks need the COOP headers -- preview
     * has its own headers config that does not inherit from server.
     */
    expect(after).toContain("server:");
    expect(after).toContain("preview:");
  });

  it("is a no-op when server, preview, and optimizeDeps are all already set", async () => {
    const abs = await writeFile(
      "vite.config.ts",
      `import { defineConfig } from "vite";\nexport default defineConfig({\n  server: {\n    headers: {\n      "Cross-Origin-Opener-Policy": "same-origin",\n      "Cross-Origin-Embedder-Policy": "require-corp"\n    }\n  },\n  preview: {\n    headers: {\n      "Cross-Origin-Opener-Policy": "same-origin",\n      "Cross-Origin-Embedder-Policy": "require-corp"\n    }\n  },\n  optimizeDeps: { exclude: ["supersonic-scsynth"] }\n});\n`
    );
    const before = await fs.readFile(abs, "utf8");

    const result = await patchViteConfig(abs, "vite.config.ts");
    expect(result.status).toBe("already-configured");

    const after = await fs.readFile(abs, "utf8");
    expect(after).toBe(before);
  });

  it("adds preview.headers even when server.headers is already set", async () => {
    const abs = await writeFile(
      "vite.config.ts",
      `import { defineConfig } from "vite";\nexport default defineConfig({\n  server: {\n    headers: {\n      "Cross-Origin-Opener-Policy": "same-origin",\n      "Cross-Origin-Embedder-Policy": "require-corp"\n    }\n  }\n});\n`
    );

    const result = await patchViteConfig(abs, "vite.config.ts");
    expect(result.status).toBe("patched");

    const after = await fs.readFile(abs, "utf8");
    expect(after).toContain("preview:");
    expect(after.match(/Cross-Origin-Opener-Policy/g)?.length).toBe(2);
  });

  it("preserves other config fields when adding headers", async () => {
    const abs = await writeFile(
      "vite.config.ts",
      `import { defineConfig } from "vite";\nexport default defineConfig({\n  base: "/app",\n  plugins: []\n});\n`
    );

    await patchViteConfig(abs, "vite.config.ts");
    const after = await fs.readFile(abs, "utf8");
    expect(after).toContain(`base: "/app"`);
    expect(after).toContain("plugins:");
    expect(after).toContain("Cross-Origin-Opener-Policy");
  });

  it("extends an existing optimizeDeps.exclude array rather than replacing it", async () => {
    const abs = await writeFile(
      "vite.config.ts",
      `import { defineConfig } from "vite";\nexport default defineConfig({\n  optimizeDeps: { exclude: ["@my/package"] }\n});\n`
    );

    await patchViteConfig(abs, "vite.config.ts");
    const after = await fs.readFile(abs, "utf8");
    expect(after).toContain("@my/package");
    expect(after).toContain("supersonic-scsynth");
  });

  it("falls back to manual-required if the file can't be parsed", async () => {
    const abs = await writeFile("vite.config.ts", `// not a real ES module { { {\n`);
    const result = await patchViteConfig(abs, "vite.config.ts");
    expect(result.status).toBe("manual-required");
    expect(result.manualSteps?.join("\n")).toContain("Cross-Origin-Opener-Policy");
  });

  it("falls back to manual-required for non-object, non-call exports", async () => {
    const abs = await writeFile(
      "vite.config.ts",
      `import { defineConfig } from "vite";\nconst cfg = defineConfig({});\nexport default cfg;\n`
    );
    const result = await patchViteConfig(abs, "vite.config.ts");
    expect(result.status).toBe("manual-required");
  });
});

describe("patchNextConfig", () => {
  it("returns already-configured if the file mentions the COOP headers", async () => {
    const abs = await writeFile(
      "next.config.js",
      `module.exports = {\n  async headers() {\n    return [{ source: "/:path*", headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin" }, { key: "Cross-Origin-Embedder-Policy", value: "require-corp" }] }];\n  }\n};\n`
    );

    const result = await patchNextConfig(abs, "next.config.js");
    expect(result.status).toBe("already-configured");
  });

  it("returns manual-required for an unmodified config", async () => {
    const abs = await writeFile("next.config.js", `module.exports = {};\n`);
    const result = await patchNextConfig(abs, "next.config.js");
    expect(result.status).toBe("manual-required");
    expect(result.manualSteps?.join("\n")).toContain("Cross-Origin-Opener-Policy");
  });

  it("returns manual-required if the file is missing on disk", async () => {
    const result = await patchNextConfig(join(root, "does-not-exist.js"), "next.config.js");
    expect(result.status).toBe("manual-required");
  });
});

describe("patchConfigDetailed", () => {
  it("routes vite frameworks to the vite patcher", async () => {
    await writeFile(
      "vite.config.ts",
      `import { defineConfig } from "vite";\nexport default defineConfig({});\n`
    );
    const [result] = await patchConfigDetailed(project({ framework: "vite-vanilla" }));
    expect(result.status).toBe("patched");
  });

  it("returns manual-required when there's no config file", async () => {
    const [result] = await patchConfigDetailed(
      project({ framework: "vanilla-html", configFile: null })
    );
    expect(result.status).toBe("manual-required");
    expect(result.manualSteps?.join("\n")).toContain("Cross-Origin-Opener-Policy");
  });

  it("returns manual-required for unknown framework", async () => {
    const [result] = await patchConfigDetailed(project({ framework: "unknown", configFile: null }));
    expect(result.status).toBe("manual-required");
  });
});
