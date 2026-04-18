/**
 * Scaffolds the `underscore.ts` wrapper and a framework-appropriate demo
 * component.
 *
 * Invariants:
 *  - Never overwrite an existing file. If a target already exists, skip it
 *    and include it in the skipped list. The user can always delete the
 *    existing file and rerun `npx @underscore-audio/wizard`.
 *  - Only write plain TS/TSX/Vue/Svelte/HTML -- no framework-specific
 *    "magic" templates. Users should be able to read the generated code and
 *    understand exactly what it does.
 *  - The generated wrapper exposes ONE class instance the demo component
 *    uses. Keeps the demo snippet small and focused on "look, it plays".
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { DetectedProject, DiscoverComposition, Framework } from "./types.js";

export interface ScaffoldResult {
  written: string[];
  skipped: string[];
}

const DEFAULT_COMPOSITION_ID = "cmp_starter";
const DEFAULT_SYNTH_NAME = "starter";

export async function scaffoldFiles(
  project: DetectedProject,
  compositions: DiscoverComposition[]
): Promise<string[]> {
  const { written } = await scaffoldFilesDetailed(project, compositions);
  return written;
}

export async function scaffoldFilesDetailed(
  project: DetectedProject,
  compositions: DiscoverComposition[]
): Promise<ScaffoldResult> {
  const written: string[] = [];
  const skipped: string[] = [];

  const first = compositions[0];
  const compositionId = first?.id ?? DEFAULT_COMPOSITION_ID;
  const synthName = first?.previewSynthName ?? DEFAULT_SYNTH_NAME;

  const wrapperTarget = wrapperPath(project.framework);
  const demoTarget = demoPath(project.framework);

  if (wrapperTarget) {
    const ok = await writeIfAbsent(
      join(project.root, wrapperTarget),
      wrapperSource(project.framework)
    );
    (ok ? written : skipped).push(wrapperTarget);
  }

  if (demoTarget) {
    const ok = await writeIfAbsent(
      join(project.root, demoTarget),
      demoSource(project.framework, compositionId, synthName)
    );
    (ok ? written : skipped).push(demoTarget);
  }

  return { written, skipped };
}

async function writeIfAbsent(abs: string, contents: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return false;
  } catch {
    /* file doesn't exist - safe to write */
  }
  await fs.mkdir(dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, "utf8");
  return true;
}

export function wrapperPath(framework: Framework): string | null {
  switch (framework) {
    case "vite-vanilla":
    case "vite-react":
    case "vite-vue":
    case "vite-svelte":
      return "src/underscore.ts";
    case "next-app":
    case "next-pages":
      return "lib/underscore.ts";
    case "vanilla-html":
      return "underscore.js";
    case "unknown":
      return null;
  }
}

export function demoPath(framework: Framework): string | null {
  switch (framework) {
    case "vite-react":
      return "src/UnderscoreDemo.tsx";
    case "vite-vue":
      return "src/UnderscoreDemo.vue";
    case "vite-svelte":
      return "src/UnderscoreDemo.svelte";
    case "vite-vanilla":
      return "src/underscore-demo.ts";
    case "next-app":
      return "components/UnderscoreDemo.tsx";
    case "next-pages":
      return "components/UnderscoreDemo.tsx";
    case "vanilla-html":
      return "underscore-demo.html";
    case "unknown":
      return null;
  }
}

/**
 * Generates the underscore client wrapper. Each framework gets the right
 * env var name so users don't have to figure out `import.meta.env` vs
 * `process.env` themselves.
 */
export function wrapperSource(framework: Framework): string {
  if (framework === "vanilla-html") {
    return `/*
 * Thin wrapper around @underscore-audio/sdk. Imported by underscore-demo.html.
 *
 * Replace the API key with a real value loaded from your own secret store
 * in production. For local development the wizard writes the value to
 * .env which this file reads via window.UNDERSCORE_PUBLISHABLE_KEY.
 */
import { Underscore } from "@underscore-audio/sdk";

const apiKey = (globalThis as any).UNDERSCORE_PUBLISHABLE_KEY;
if (!apiKey) {
  console.warn(
    "UNDERSCORE_PUBLISHABLE_KEY is not defined. Add it to window or replace this line with a literal key."
  );
}

export const underscore = new Underscore({
  apiKey: apiKey ?? "",
  wasmBaseUrl: "/supersonic/",
});
`;
  }

  const keyAccessor = envAccessor(framework);
  const keyName = publishableKeyName(framework);

  return `/*
 * Thin wrapper around @underscore-audio/sdk.
 *
 * The wizard wrote ${keyName} to your env file. This wrapper reads it so
 * components can import a single preconfigured client instance. Swap
 * baseUrl / wasmBaseUrl here if you later move to a custom deployment.
 */
import { Underscore } from "@underscore-audio/sdk";

const apiKey = ${keyAccessor};

if (!apiKey) {
  throw new Error(
    "${keyName} is not set. Re-run \`npx @underscore-audio/wizard@latest\` or set it manually."
  );
}

export const underscore = new Underscore({
  apiKey,
  wasmBaseUrl: "/supersonic/",
});
`;
}

function envAccessor(framework: Framework): string {
  if (framework.startsWith("vite-")) {
    return `import.meta.env.${publishableKeyName(framework)}`;
  }
  if (framework === "next-app" || framework === "next-pages") {
    return `process.env.${publishableKeyName(framework)}`;
  }
  return `process.env.${publishableKeyName(framework)}`;
}

function publishableKeyName(framework: Framework): string {
  if (framework.startsWith("vite-")) return "VITE_UNDERSCORE_PUBLISHABLE_KEY";
  if (framework === "next-app" || framework === "next-pages") return "NEXT_PUBLIC_UNDERSCORE_PUBLISHABLE_KEY";
  return "UNDERSCORE_PUBLISHABLE_KEY";
}

export function demoSource(framework: Framework, compositionId: string, synthName: string): string {
  switch (framework) {
    case "vite-react":
    case "next-app":
    case "next-pages":
      return reactDemo(framework, compositionId, synthName);
    case "vite-vue":
      return vueDemo(compositionId, synthName);
    case "vite-svelte":
      return svelteDemo(compositionId, synthName);
    case "vite-vanilla":
      return vanillaTsDemo(compositionId, synthName);
    case "vanilla-html":
      return vanillaHtmlDemo(compositionId, synthName);
    case "unknown":
      return "";
  }
}

function reactDemo(framework: Framework, compositionId: string, synthName: string): string {
  const wrapperImport =
    framework === "next-app" || framework === "next-pages" ? "@/lib/underscore" : "./underscore";
  const directive = framework === "next-app" ? `"use client";\n\n` : "";
  return `${directive}import { useState } from "react";
import { underscore } from "${wrapperImport}";

/*
 * Demo component generated by \`npx @underscore-audio/wizard\`. Click "Play" to
 * initialize the audio engine (browsers block audio until a user gesture)
 * and start the starter synth. Safe to delete once you have your own UI.
 */
export function UnderscoreDemo() {
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function play() {
    setStatus("loading");
    setError(null);
    try {
      await underscore.init();
      const synth = await underscore.loadSynth(${JSON.stringify(compositionId)}, ${JSON.stringify(synthName)});
      await synth.play();
      setStatus("playing");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <button onClick={play} disabled={status === "loading"}>
        {status === "playing" ? "Playing" : "Play Underscore starter"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
`;
}

function vueDemo(compositionId: string, synthName: string): string {
  return `<script setup lang="ts">
import { ref } from "vue";
import { underscore } from "./underscore";

const status = ref<"idle" | "loading" | "playing" | "error">("idle");
const error = ref<string | null>(null);

async function play() {
  status.value = "loading";
  error.value = null;
  try {
    await underscore.init();
    const synth = await underscore.loadSynth(${JSON.stringify(compositionId)}, ${JSON.stringify(synthName)});
    await synth.play();
    status.value = "playing";
  } catch (err) {
    status.value = "error";
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div style="padding:16px;font-family:system-ui,sans-serif">
    <button :disabled="status === 'loading'" @click="play">
      {{ status === "playing" ? "Playing" : "Play Underscore starter" }}
    </button>
    <p v-if="error" style="color:crimson">{{ error }}</p>
  </div>
</template>
`;
}

function svelteDemo(compositionId: string, synthName: string): string {
  return `<script lang="ts">
  import { underscore } from "./underscore";

  let status: "idle" | "loading" | "playing" | "error" = "idle";
  let error: string | null = null;

  async function play() {
    status = "loading";
    error = null;
    try {
      await underscore.init();
      const synth = await underscore.loadSynth(${JSON.stringify(compositionId)}, ${JSON.stringify(synthName)});
      await synth.play();
      status = "playing";
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div style="padding:16px;font-family:system-ui,sans-serif">
  <button on:click={play} disabled={status === "loading"}>
    {status === "playing" ? "Playing" : "Play Underscore starter"}
  </button>
  {#if error}
    <p style="color:crimson">{error}</p>
  {/if}
</div>
`;
}

function vanillaTsDemo(compositionId: string, synthName: string): string {
  return `import { underscore } from "./underscore";

/*
 * Demo wired by \`npx @underscore-audio/wizard\`. Call bindPlayButton with any
 * DOM button element; clicking it will initialize the engine and play the
 * starter synth.
 */
export function bindPlayButton(button: HTMLButtonElement): void {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await underscore.init();
      const synth = await underscore.loadSynth(${JSON.stringify(compositionId)}, ${JSON.stringify(synthName)});
      await synth.play();
      button.textContent = "Playing Underscore starter";
    } catch (err) {
      button.textContent = err instanceof Error ? err.message : "Playback failed";
    }
  });
}
`;
}

function vanillaHtmlDemo(compositionId: string, synthName: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Underscore starter</title>
  </head>
  <body>
    <button id="play">Play Underscore starter</button>
    <script type="module">
      import { Underscore } from "/node_modules/@underscore-audio/sdk/dist/index.js";

      /* Replace with your real publishable key from .env before deploying. */
      const client = new Underscore({
        apiKey: window.UNDERSCORE_PUBLISHABLE_KEY ?? "",
        wasmBaseUrl: "/supersonic/",
      });

      document.getElementById("play").addEventListener("click", async () => {
        await client.init();
        const synth = await client.loadSynth(${JSON.stringify(compositionId)}, ${JSON.stringify(synthName)});
        await synth.play();
      });
    </script>
  </body>
</html>
`;
}
