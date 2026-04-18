/**
 * Shared types for the Underscore wizard.
 *
 * The wizard is a pipeline: detect -> auth -> install -> patch -> env ->
 * scan+discover -> scaffold. Each step returns a typed result the next step
 * consumes. Keeping these contracts explicit makes each step individually
 * testable and keeps `run.ts` a thin orchestrator.
 */

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type Framework =
  | "vite-vanilla"
  | "vite-react"
  | "vite-vue"
  | "vite-svelte"
  | "next-app"
  | "next-pages"
  | "vanilla-html"
  | "unknown";

export interface DetectedProject {
  root: string;
  framework: Framework;
  packageManager: PackageManager;
  publicDir: string;
  envFile: string;
  configFile: string | null;
  entryFile: string | null;
}

export interface ApiKeys {
  publishableKey: string;
  secretKey?: string;
}

export interface DiscoverComposition {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  previewSynthName: string | null;
}

export interface WizardOptions {
  cwd: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  nonInteractive: boolean;
  skipInstall: boolean;
  skipScaffold: boolean;
  /*
   * Hook to replace the platform "open browser" behavior. Exists so e2e
   * tests can drive the device-code flow with a Playwright page instead of
   * spawning the platform opener. When set, takes precedence over the
   * default behavior; when unset, auth.ts falls back to execa(open).
   */
  openBrowser?: (url: string) => Promise<void>;
  /*
   * Map of package name to local tarball path. When provided, install.ts
   * passes the tarball path to the detected package manager instead of the
   * registry name, keeping e2e runs off the public registry. Keys should
   * match the registered dep names (e.g. "@underscore-audio/sdk",
   * "supersonic-scsynth"); unmapped packages fall back to registry install.
   */
  tarballOverrides?: Record<string, string>;
}

export interface WizardResult {
  project: DetectedProject;
  keys: ApiKeys;
  compositions: DiscoverComposition[];
  writtenFiles: string[];
  patchedFiles: string[];
}
