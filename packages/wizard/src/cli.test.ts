/**
 * Pure unit tests for CLI argument parsing.
 *
 * The entry file (`cli.ts`) is deliberately shaped so parsing and option
 * construction are pure functions we can exercise without spawning a
 * subprocess. The end-to-end CLI behavior is covered by the broader
 * wizard-tests task.
 */

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  parseArgs,
  argsToOptions,
  helpText,
  CliArgError,
  resolveCliEntryPoint,
} from "./cli.js";

describe("parseArgs", () => {
  it("returns default parsed flags when argv is empty", () => {
    expect(parseArgs([])).toMatchObject({
      help: false,
      version: false,
      nonInteractive: false,
      skipInstall: false,
      skipScaffold: false,
    });
  });

  it("supports short and long help/version flags", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
  });

  it("supports non-interactive aliases", () => {
    expect(parseArgs(["-y"]).nonInteractive).toBe(true);
    expect(parseArgs(["--yes"]).nonInteractive).toBe(true);
    expect(parseArgs(["--non-interactive"]).nonInteractive).toBe(true);
  });

  it("accepts split and equals form for base-url flags", () => {
    expect(parseArgs(["--api-base-url", "http://localhost:4000"]).apiBaseUrl).toBe(
      "http://localhost:4000"
    );
    expect(parseArgs(["--api-base-url=http://localhost:4000"]).apiBaseUrl).toBe(
      "http://localhost:4000"
    );
  });

  it("throws CliArgError on unknown flags", () => {
    expect(() => parseArgs(["--nope"])).toThrowError(CliArgError);
  });

  it("throws CliArgError when --api-base-url is missing its value", () => {
    expect(() => parseArgs(["--api-base-url"])).toThrowError(/requires a value/);
  });
});

describe("argsToOptions", () => {
  it("falls back to env vars when flags are absent", () => {
    const options = argsToOptions(
      { help: false, version: false, nonInteractive: false, skipInstall: false, skipScaffold: false },
      "/tmp/app",
      { UNDERSCORE_API_BASE_URL: "http://api.local", UNDERSCORE_WEB_BASE_URL: "http://web.local" }
    );
    expect(options).toMatchObject({
      cwd: "/tmp/app",
      apiBaseUrl: "http://api.local",
      webBaseUrl: "http://web.local",
    });
  });

  it("prefers explicit flags over env", () => {
    const options = argsToOptions(
      {
        help: false,
        version: false,
        nonInteractive: false,
        skipInstall: false,
        skipScaffold: false,
        apiBaseUrl: "http://flag.api",
      },
      "/tmp/app",
      { UNDERSCORE_API_BASE_URL: "http://env.api" }
    );
    expect(options.apiBaseUrl).toBe("http://flag.api");
  });

  it("uses production defaults when nothing is set", () => {
    const options = argsToOptions(
      { help: false, version: false, nonInteractive: false, skipInstall: false, skipScaffold: false },
      "/tmp/app",
      {}
    );
    expect(options.apiBaseUrl).toBe("https://api.underscore.audio");
    expect(options.webBaseUrl).toBe("https://underscore.audio");
  });
});

describe("helpText", () => {
  it("includes the key flags", () => {
    const text = helpText();
    expect(text).toContain("@underscore-audio/wizard");
    expect(text).toContain("--skip-install");
    expect(text).toContain("--non-interactive");
  });
});

/**
 * Regression guard for the silent-exit bug we shipped in 0.1.0. npm/npx
 * invokes bin scripts via a symlink under `node_modules/.bin/`; the old
 * entry-point check compared `process.argv[1]` directly to `import.meta.url`
 * and never matched, so `main()` was never called. These tests exercise the
 * exact failure mode by building a temp directory where the bin file is a
 * symlink to the "module" file -- matching the layout that npm produces.
 */
describe("resolveCliEntryPoint", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "wizard-cli-entry-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns true when argv[1] is a symlink to the module file", () => {
    const pkgDir = join(tmpRoot, "pkg", "dist");
    const binDir = join(tmpRoot, ".bin");
    mkdirSync(pkgDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const modulePath = join(pkgDir, "cli.js");
    const binPath = join(binDir, "underscore-wizard");
    writeFileSync(modulePath, "export {};\n");
    symlinkSync(modulePath, binPath);

    const moduleUrl = pathToFileURL(modulePath).href;
    expect(resolveCliEntryPoint(binPath, moduleUrl)).toBe(true);
  });

  it("returns true when argv[1] is the module file itself", () => {
    const modulePath = join(tmpRoot, "cli.js");
    writeFileSync(modulePath, "export {};\n");
    const moduleUrl = pathToFileURL(modulePath).href;
    expect(resolveCliEntryPoint(modulePath, moduleUrl)).toBe(true);
  });

  it("returns false when argv[1] points to an unrelated file", () => {
    const modulePath = join(tmpRoot, "cli.js");
    const otherPath = join(tmpRoot, "other.js");
    writeFileSync(modulePath, "export {};\n");
    writeFileSync(otherPath, "export {};\n");
    const moduleUrl = pathToFileURL(modulePath).href;
    expect(resolveCliEntryPoint(otherPath, moduleUrl)).toBe(false);
  });

  it("returns false when argv[1] is undefined (module imported, not executed)", () => {
    const modulePath = join(tmpRoot, "cli.js");
    writeFileSync(modulePath, "export {};\n");
    const moduleUrl = pathToFileURL(modulePath).href;
    expect(resolveCliEntryPoint(undefined, moduleUrl)).toBe(false);
  });

  it("returns false (not throwing) when argv[1] points to a nonexistent path", () => {
    const modulePath = join(tmpRoot, "cli.js");
    writeFileSync(modulePath, "export {};\n");
    const moduleUrl = pathToFileURL(modulePath).href;
    expect(resolveCliEntryPoint(join(tmpRoot, "missing"), moduleUrl)).toBe(false);
  });
});
