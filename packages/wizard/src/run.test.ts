/**
 * Integration-ish test for the wizard orchestrator.
 *
 * Each phase module is mocked so we can assert that run.ts:
 *  - calls phases in the correct order,
 *  - respects the skipInstall / skipScaffold flags,
 *  - aggregates written / patched file paths into the returned result.
 *
 * We deliberately keep the phase mocks dumb: none of them exercise real
 * behavior. The per-module tests already cover that; this file's only job
 * is to lock in the wiring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WizardOptions } from "./types.js";

const detectMock = vi.fn();
const authMock = vi.fn();
const installMock = vi.fn();
const copyMock = vi.fn();
const patchMock = vi.fn();
const envMock = vi.fn();
const scanMock = vi.fn();
const discoverMock = vi.fn();
const scaffoldMock = vi.fn();

vi.mock("./detect.js", () => ({
  detectProject: (...args: unknown[]) => detectMock(...args),
}));
vi.mock("./auth.js", () => ({
  authenticate: (...args: unknown[]) => authMock(...args),
}));
vi.mock("./install.js", () => ({
  installDependencies: (...args: unknown[]) => installMock(...args),
  copyWasmAssets: (...args: unknown[]) => copyMock(...args),
}));
vi.mock("./patch.js", () => ({
  patchConfigDetailed: (...args: unknown[]) => patchMock(...args),
}));
vi.mock("./env.js", () => ({
  writeEnv: (...args: unknown[]) => envMock(...args),
}));
vi.mock("./scan.js", () => ({
  scanProjectForTags: (...args: unknown[]) => scanMock(...args),
}));
vi.mock("./discover.js", () => ({
  pickStarterCompositions: (...args: unknown[]) => discoverMock(...args),
}));
vi.mock("./scaffold.js", () => ({
  scaffoldFiles: (...args: unknown[]) => scaffoldMock(...args),
}));

const baseOptions: WizardOptions = {
  cwd: "/tmp/app",
  apiBaseUrl: "http://api.test",
  webBaseUrl: "http://web.test",
  nonInteractive: true,
  skipInstall: false,
  skipScaffold: false,
};

function detectedProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

beforeEach(() => {
  vi.clearAllMocks();
  detectMock.mockResolvedValue(detectedProject());
  authMock.mockResolvedValue({ publishableKey: "pk_123" });
  installMock.mockResolvedValue(undefined);
  copyMock.mockResolvedValue(["public/supersonic"]);
  patchMock.mockResolvedValue([{ file: "vite.config.ts", status: "patched" }]);
  envMock.mockResolvedValue("/tmp/app/.env.local");
  scanMock.mockResolvedValue(["retro", "game"]);
  discoverMock.mockResolvedValue([
    { id: "cmp_1", title: "Retro", tags: ["retro"], previewSynthName: "pad_v1" },
  ]);
  scaffoldMock.mockResolvedValue(["src/underscore.ts", "src/UnderscoreDemo.tsx"]);
});

describe("runWizard", () => {
  it("runs phases in the expected order and returns an aggregated result", async () => {
    const { runWizard } = await import("./run.js");
    const result = await runWizard(baseOptions);

    expect(detectMock).toHaveBeenCalledTimes(1);
    expect(authMock).toHaveBeenCalledTimes(1);
    expect(installMock).toHaveBeenCalledTimes(1);
    expect(installMock).toHaveBeenCalledWith(expect.any(Object), baseOptions);
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(envMock).toHaveBeenCalledTimes(1);
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(discoverMock).toHaveBeenCalledTimes(1);
    expect(scaffoldMock).toHaveBeenCalledTimes(1);

    expect(result).toMatchObject({
      keys: { publishableKey: "pk_123" },
      patchedFiles: ["vite.config.ts"],
    });
    expect(result.writtenFiles).toEqual(
      expect.arrayContaining([
        "public/supersonic",
        "/tmp/app/.env.local",
        "src/underscore.ts",
        "src/UnderscoreDemo.tsx",
      ])
    );
    expect(result.compositions[0].id).toBe("cmp_1");
  });

  it("skips install + copy when skipInstall is set", async () => {
    const { runWizard } = await import("./run.js");
    await runWizard({ ...baseOptions, skipInstall: true });
    expect(installMock).not.toHaveBeenCalled();
    expect(copyMock).not.toHaveBeenCalled();
    expect(envMock).toHaveBeenCalledTimes(1);
    expect(scaffoldMock).toHaveBeenCalledTimes(1);
  });

  it("skips scaffold when skipScaffold is set", async () => {
    const { runWizard } = await import("./run.js");
    const result = await runWizard({ ...baseOptions, skipScaffold: true });
    expect(scaffoldMock).not.toHaveBeenCalled();
    expect(result.writtenFiles).not.toContain("src/underscore.ts");
  });

  it("still writes env when scan returns no tags (fail-open)", async () => {
    scanMock.mockResolvedValueOnce([]);
    discoverMock.mockResolvedValueOnce([]);
    const { runWizard } = await import("./run.js");
    const result = await runWizard(baseOptions);
    expect(result.compositions).toEqual([]);
    expect(envMock).toHaveBeenCalledTimes(1);
  });

  /*
   * Regression: when patchConfigDetailed reports manual-required we
   * used to silently drop the result, so users with a non-patchable
   * config walked away thinking the wizard succeeded. The result
   * should NOT contain that file in patchedFiles, so they can tell.
   */
  it("does not claim a manual-required file was patched", async () => {
    patchMock.mockResolvedValueOnce([
      {
        file: "vite.config.ts",
        status: "manual-required",
        manualSteps: ["add COOP/COEP headers"],
      },
    ]);
    const { runWizard } = await import("./run.js");
    const result = await runWizard(baseOptions);
    expect(result.patchedFiles).not.toContain("vite.config.ts");
    expect(result.patchedFiles).toEqual([]);
  });

  it("propagates auth errors without writing any files", async () => {
    authMock.mockRejectedValueOnce(new Error("no browser"));
    const { runWizard } = await import("./run.js");
    await expect(runWizard(baseOptions)).rejects.toThrow(/no browser/);
    expect(installMock).not.toHaveBeenCalled();
    expect(envMock).not.toHaveBeenCalled();
    expect(scaffoldMock).not.toHaveBeenCalled();
  });
});
