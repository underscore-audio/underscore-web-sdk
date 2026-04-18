/**
 * Pure unit tests for CLI argument parsing.
 *
 * The entry file (`cli.ts`) is deliberately shaped so parsing and option
 * construction are pure functions we can exercise without spawning a
 * subprocess. The end-to-end CLI behavior is covered by the broader
 * wizard-tests task.
 */

import { describe, it, expect } from "vitest";
import { parseArgs, argsToOptions, helpText, CliArgError } from "./cli.js";

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
    expect(text).toContain("@underscore/wizard");
    expect(text).toContain("--skip-install");
    expect(text).toContain("--non-interactive");
  });
});
