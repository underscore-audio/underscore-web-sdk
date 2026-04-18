/**
 * Dependency install + WASM asset copy.
 *
 * Two responsibilities:
 *   1. Install @underscore-audio/sdk + supersonic-scsynth using the project's
 *      package manager (as detected in detect.ts).
 *   2. Invoke the underscore-sdk `copy-assets` bin to populate the public
 *      directory with WASM + workers. We shell out rather than importing
 *      the logic directly so the wizard stays loosely coupled to the SDK
 *      package internals.
 */

import { join } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { execa } from "execa";
import type { DetectedProject, PackageManager, WizardOptions } from "./types.js";

export interface InstallDependencies {
  /**
   * Injection seam for tests. Defaults to execa.
   */
  run?: (cmd: string, args: string[], opts: { cwd: string }) => Promise<void>;
}

/*
 * We pin supersonic-scsynth here to the same range the SDK declares as a
 * peer dependency (^0.14.0). Without a version specifier npm resolves to
 * latest, which at the time of writing is 0.66 -- a major that relocated
 * the WASM assets away from `dist/wasm/`. copyWasmAssets would then fail
 * silently for every new user. Tests that use tarballOverrides replace
 * the spec wholesale, so the pin only ever affects real installs.
 */
const SDK_PACKAGES = ["@underscore-audio/sdk", "supersonic-scsynth@^0.14.0"] as const;

/**
 * Package-manager specific install commands. Kept as a data table so the
 * shape of the dispatch is obvious at a glance; any PM-specific flags live
 * next to their command name.
 *
 * When `tarballOverrides` is provided, any package listed there is replaced
 * with its local tarball path. This keeps e2e runs off the public registry
 * without changing the call site in run.ts. Packages not in the override
 * map pass through as their normal registry name, so partial overrides
 * (e.g. just "@underscore-audio/sdk") still work.
 */
function installCommand(
  pm: PackageManager,
  tarballOverrides?: Record<string, string>
): { cmd: string; args: string[] } {
  /*
   * SDK_PACKAGES entries may include version specifiers (e.g.
   * "supersonic-scsynth@^0.14.0") so we strip the @version tail when
   * looking up the overrides map. Override keys are bare package names
   * ("supersonic-scsynth"), which matches how a caller would write them.
   */
  const resolved = SDK_PACKAGES.map((spec) => {
    const bareName = spec.startsWith("@")
      ? "@" + spec.slice(1).split("@")[0]
      : spec.split("@")[0];
    return tarballOverrides?.[bareName] ?? spec;
  });
  switch (pm) {
    case "pnpm":
      return { cmd: "pnpm", args: ["add", ...resolved] };
    case "yarn":
      return { cmd: "yarn", args: ["add", ...resolved] };
    case "bun":
      return { cmd: "bun", args: ["add", ...resolved] };
    case "npm":
      return { cmd: "npm", args: ["install", ...resolved] };
  }
}

async function defaultRun(cmd: string, args: string[], opts: { cwd: string }): Promise<void> {
  await execa(cmd, args, { cwd: opts.cwd, stdio: "inherit" });
}

export async function installDependencies(
  project: DetectedProject,
  options: WizardOptions,
  deps: InstallDependencies = {}
): Promise<void> {
  const run = deps.run ?? defaultRun;
  const { cmd, args } = installCommand(project.packageManager, options.tarballOverrides);

  const spinner = p.spinner();
  spinner.start(`Installing ${SDK_PACKAGES.join(" + ")} with ${pc.cyan(project.packageManager)}...`);
  try {
    await run(cmd, args, { cwd: project.root });
    spinner.stop(pc.green("Installed SDK dependencies."));
  } catch (err) {
    spinner.stop(pc.red("Dependency install failed."));
    throw new Error(
      `${cmd} ${args.join(" ")} failed in ${project.root}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Invoke the underscore-sdk CLI to copy WASM + worker files into the
 * project's public directory. We rely on the fact that the SDK bin is
 * now a declared dep (via `installDependencies` above) and therefore
 * resolvable as a local binary.
 *
 * Tradeoff: we could import from "@underscore-audio/sdk/bin/copy-assets" directly
 * and avoid the subprocess, but then a change to the SDK's bin layout would
 * silently break the wizard. Shelling out to the published bin keeps us
 * honest about what "users running npx ..." would see.
 */
export async function copyWasmAssets(
  project: DetectedProject,
  deps: InstallDependencies = {}
): Promise<string[]> {
  const run = deps.run ?? defaultRun;

  const target = join(project.publicDir, "supersonic");
  const spinner = p.spinner();
  spinner.start(`Copying WASM assets to ${pc.cyan(target)}...`);

  try {
    await run(
      "npx",
      ["underscore-sdk", target],
      { cwd: project.root }
    );
    spinner.stop(pc.green(`Copied WASM assets to ${target}.`));
    return [target];
  } catch (err) {
    spinner.stop(pc.red("WASM asset copy failed."));
    throw new Error(
      `underscore-sdk copy failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
