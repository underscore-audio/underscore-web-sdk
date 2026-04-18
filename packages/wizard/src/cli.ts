#!/usr/bin/env node
/**
 * CLI entry point for `npx @underscore/wizard`.
 *
 * This file does only two things: parse a minimal set of flags and call
 * `runWizard`. All logic, prompts, and side effects live in the modules under
 * `./`, which lets us unit-test them without spawning subprocesses.
 */

import pc from "picocolors";
import { runWizard } from "./run.js";
import type { WizardOptions } from "./types.js";

export interface ParsedArgs {
  help: boolean;
  version: boolean;
  nonInteractive: boolean;
  skipInstall: boolean;
  skipScaffold: boolean;
  apiBaseUrl?: string;
  webBaseUrl?: string;
}

export class CliArgError extends Error {
  constructor(
    message: string,
    readonly exitCode: number
  ) {
    super(message);
    this.name = "CliArgError";
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    help: false,
    version: false,
    nonInteractive: false,
    skipInstall: false,
    skipScaffold: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "-v":
      case "--version":
        parsed.version = true;
        break;
      case "-y":
      case "--yes":
      case "--non-interactive":
        parsed.nonInteractive = true;
        break;
      case "--skip-install":
        parsed.skipInstall = true;
        break;
      case "--skip-scaffold":
        parsed.skipScaffold = true;
        break;
      case "--api-base-url":
        parsed.apiBaseUrl = argv[++i];
        if (!parsed.apiBaseUrl) {
          throw new CliArgError("--api-base-url requires a value", 2);
        }
        break;
      case "--web-base-url":
        parsed.webBaseUrl = argv[++i];
        if (!parsed.webBaseUrl) {
          throw new CliArgError("--web-base-url requires a value", 2);
        }
        break;
      default:
        if (arg.startsWith("--api-base-url=")) {
          parsed.apiBaseUrl = arg.slice("--api-base-url=".length);
        } else if (arg.startsWith("--web-base-url=")) {
          parsed.webBaseUrl = arg.slice("--web-base-url=".length);
        } else {
          throw new CliArgError(`Unknown argument: ${arg}`, 2);
        }
    }
  }

  return parsed;
}

export function helpText(): string {
  return `
${pc.bold("@underscore/wizard")} - install Underscore in your web app

${pc.bold("Usage:")}
  npx @underscore/wizard@latest [options]

${pc.bold("Options:")}
  -y, --yes, --non-interactive   Accept defaults without prompts (CI use)
      --skip-install             Don't install dependencies
      --skip-scaffold            Don't generate demo code
      --api-base-url <url>       Override Underscore API base URL
      --web-base-url <url>       Override Underscore web base URL
  -h, --help                     Show this help
  -v, --version                  Show wizard version
`;
}

export function argsToOptions(args: ParsedArgs, cwd: string, env: NodeJS.ProcessEnv): WizardOptions {
  return {
    cwd,
    apiBaseUrl: args.apiBaseUrl ?? env.UNDERSCORE_API_BASE_URL ?? "https://api.underscore.audio",
    webBaseUrl: args.webBaseUrl ?? env.UNDERSCORE_WEB_BASE_URL ?? "https://underscore.audio",
    nonInteractive: args.nonInteractive,
    skipInstall: args.skipInstall,
    skipScaffold: args.skipScaffold,
  };
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliArgError) {
      console.error(pc.red(error.message));
      console.error("Run with --help to see available flags.");
      process.exit(error.exitCode);
    }
    throw error;
  }

  if (args.help) {
    console.log(helpText());
    return;
  }

  if (args.version) {
    const pkg = (await import("../package.json", { with: { type: "json" } })) as {
      default: { version: string };
    };
    console.log(pkg.default.version);
    return;
  }

  const options = argsToOptions(args, process.cwd(), process.env);

  try {
    await runWizard(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(`\nWizard failed: ${message}`));
    process.exit(1);
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(pc.red(`Fatal: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  });
}
