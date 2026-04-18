/**
 * Public entry for programmatic use of the wizard.
 *
 * The supported surface is intentionally narrow. Users should invoke the CLI
 * (`npx @underscore-audio/wizard@latest`); the `runWizard` export exists so tests
 * and potential future integrations can drive the same pipeline without
 * spawning a subprocess.
 */

export { runWizard } from "./run.js";
export type {
  ApiKeys,
  DetectedProject,
  DiscoverComposition,
  Framework,
  PackageManager,
  WizardOptions,
  WizardResult,
} from "./types.js";
