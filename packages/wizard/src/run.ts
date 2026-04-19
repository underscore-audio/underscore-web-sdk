/**
 * Wizard orchestrator.
 *
 * Each phase is an isolated module. `runWizard` is deliberately thin: it wires
 * phases together, handles user-visible progress, and is responsible for
 * deciding when a failure is fatal vs. recoverable.
 *
 * Phase order is significant:
 *  1. detect   - nothing else runs until we know the framework/package manager.
 *  2. auth     - get keys before we install anything; a failed auth shouldn't
 *                leave half-written files on disk.
 *  3. install  - deps + WASM copy. Depends on (1) for the PM and public dir.
 *  4. patch    - COOP/COEP headers + optimizeDeps. Depends on (1).
 *  5. env      - writes API keys. Depends on (1) + (2).
 *  6. discover - picks sounds. Optional; scaffold still works with defaults.
 *  7. scaffold - writes underscore.ts + demo component. Depends on (1) + (6).
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { detectProject } from "./detect.js";
import { authenticate } from "./auth.js";
import { installDependencies, copyWasmAssets } from "./install.js";
import { patchConfigDetailed } from "./patch.js";
import { writeEnv } from "./env.js";
import { scanProjectForTags } from "./scan.js";
import { pickStarterCompositions } from "./discover.js";
import { scaffoldFiles } from "./scaffold.js";
import type { WizardOptions, WizardResult } from "./types.js";

export async function runWizard(options: WizardOptions): Promise<WizardResult> {
  p.intro(pc.bold("Underscore installation wizard"));

  const project = await detectProject(options);
  p.log.info(
    `Detected ${pc.cyan(project.framework)} project (package manager: ${pc.cyan(project.packageManager)}).`
  );

  const keys = await authenticate(options);

  const writtenFiles: string[] = [];
  const patchedFiles: string[] = [];

  if (!options.skipInstall) {
    await installDependencies(project, options);
    const copied = await copyWasmAssets(project);
    writtenFiles.push(...copied);
  }

  /*
   * patchConfigDetailed also reports any files that need manual edits
   * (e.g. a custom Vite config magicast can't safely rewrite, or a
   * non-vanilla-html project with no recognized framework). We surface
   * those immediately so users don't walk away thinking the wizard
   * succeeded only to hit a cryptic SharedArrayBuffer error at runtime.
   */
  const patchResults = await patchConfigDetailed(project);
  for (const result of patchResults) {
    if (result.status === "patched") {
      patchedFiles.push(result.file);
    } else if (result.status === "manual-required") {
      p.log.warn(
        [
          `Config change required in ${pc.cyan(result.file)} -- the wizard couldn't patch it safely.`,
          ...(result.manualSteps ?? []),
        ].join("\n")
      );
    }
  }

  const envPath = await writeEnv(project, keys);
  writtenFiles.push(envPath);

  const tags = await scanProjectForTags(project);
  const compositions = await pickStarterCompositions(options, tags);

  if (!options.skipScaffold) {
    const scaffolded = await scaffoldFiles(project, compositions);
    writtenFiles.push(...scaffolded);
  }

  p.outro(pc.green("Underscore is ready. Start your dev server and you should hear sound."));

  return {
    project,
    keys,
    compositions,
    writtenFiles,
    patchedFiles,
  };
}
