/**
 * Underscore SDK - browser example using the backend-proxy pattern.
 *
 * - The browser uses only a PUBLISHABLE key (us_pub_...) for listing and
 *   loading synths.
 * - Generation is triggered via a tiny Express proxy (see server.ts)
 *   which holds the SECRET key. The proxy returns a streamUrl; the
 *   browser subscribes to it directly (no auth -- jobId is a capability
 *   token).
 */

import {
  Underscore,
  Synth,
  ApiError,
  AudioError,
  SynthError,
  ValidationError,
} from "@underscore-audio/sdk";

const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
const compositionIdInput = document.getElementById("compositionId") as HTMLInputElement;
const initBtn = document.getElementById("initBtn") as HTMLButtonElement;
const loadBtn = document.getElementById("loadBtn") as HTMLButtonElement;
const playBtn = document.getElementById("playBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;
const muteBtn = document.getElementById("muteBtn") as HTMLButtonElement;
const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement;
const generateBtn = document.getElementById("generateBtn") as HTMLButtonElement;
const promptInput = document.getElementById("prompt") as HTMLTextAreaElement;
const paramsDiv = document.getElementById("params") as HTMLDivElement;
const statusSpan = document.getElementById("status") as HTMLSpanElement;
const logDiv = document.getElementById("log") as HTMLDivElement;

const HOST = (import.meta.env.VITE_UNDERSCORE_HOST as string) || "https://underscore.audio";
const PROXY_URL = (import.meta.env.VITE_PROXY_URL as string) || "http://localhost:8787";

let client: Underscore | null = null;
let synth: Synth | null = null;
let isMuted = false;

type LogType = "info" | "error" | "warn";

function log(message: string, type: LogType = "info"): void {
  const line = document.createElement("div");
  line.className = `log-${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logDiv.appendChild(line);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function setStatus(text: string, className = ""): void {
  statusSpan.textContent = text;
  statusSpan.className = className;
}

function handleError(error: unknown, context: string): void {
  if (error instanceof ApiError) {
    log(`API Error (${error.status}): ${error.message}`, "error");
  } else if (error instanceof ValidationError) {
    log(`Validation Error: ${error.message}`, "error");
  } else if (error instanceof AudioError) {
    log(`Audio Error: ${error.message}`, "error");
  } else if (error instanceof SynthError) {
    log(`Synth Error: ${error.message}`, "error");
  } else if (error instanceof Error) {
    log(`${context}: ${error.message}`, "error");
  } else {
    log(`${context}: Unknown error`, "error");
  }
  setStatus("Error", "error");
}

initBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    log("Please enter a publishable API key (us_pub_...)", "warn");
    return;
  }
  if (!apiKey.startsWith("us_pub_")) {
    log(
      "Expected a publishable key (us_pub_...). Secret keys must never be used in the browser.",
      "warn"
    );
    return;
  }

  try {
    log(`Using host: ${HOST}`);
    client = new Underscore({
      apiKey,
      wasmBaseUrl: "/supersonic/",
      baseUrl: HOST,
      logLevel: "info",
    });

    log("Initializing audio engine...");
    await client.init();

    log("Audio engine initialized!", "info");
    setStatus("Ready", "ready");

    loadBtn.disabled = false;
    generateBtn.disabled = false;
    initBtn.disabled = true;
  } catch (error) {
    handleError(error, "Initialization failed");
  }
});

loadBtn.addEventListener("click", async () => {
  const compositionId = compositionIdInput.value.trim();
  if (!compositionId) {
    log("Please enter a composition ID", "warn");
    return;
  }

  if (!client) {
    log("Client not initialized", "error");
    return;
  }

  try {
    log(`Loading synth from ${compositionId}...`);
    loadBtn.disabled = true;

    synth = await client.loadSynth(compositionId);

    log(`Loaded: ${synth.name}`, "info");
    log(`Description: ${synth.description}`);
    log(`Parameters: ${synth.params.map((p) => p.name).join(", ")}`);

    playBtn.disabled = false;
    resetBtn.disabled = false;

    renderParams();
  } catch (error) {
    handleError(error, "Load failed");
    loadBtn.disabled = false;
  }
});

playBtn.addEventListener("click", async () => {
  if (!synth) return;

  try {
    log("Playing...");
    await synth.play();
    setStatus("Playing", "playing");

    playBtn.disabled = true;
    stopBtn.disabled = false;
    muteBtn.disabled = false;
    loadBtn.disabled = true;
  } catch (error) {
    handleError(error, "Play failed");
  }
});

stopBtn.addEventListener("click", () => {
  if (!synth) return;

  log("Stopped");
  synth.stop();
  setStatus("Ready", "ready");

  playBtn.disabled = false;
  stopBtn.disabled = true;
  muteBtn.disabled = true;
  loadBtn.disabled = false;
  isMuted = false;
  muteBtn.textContent = "Mute";
});

muteBtn.addEventListener("click", () => {
  if (!synth) return;

  if (isMuted) {
    synth.play();
    muteBtn.textContent = "Mute";
    log("Unmuted");
  } else {
    synth.stop();
    muteBtn.textContent = "Unmute";
    log("Muted");
  }
  isMuted = !isMuted;
});

resetBtn.addEventListener("click", () => {
  if (!synth) return;

  synth.resetParams();
  renderParams();
  log("Parameters reset to defaults");
});

function renderParams(): void {
  if (!synth) {
    paramsDiv.innerHTML =
      '<p style="color: #666; font-size: 13px;">Load a synth to see parameters</p>';
    return;
  }

  paramsDiv.innerHTML = "";

  for (const param of synth.params) {
    const div = document.createElement("div");
    div.className = "param";

    const label = document.createElement("label");
    label.textContent = param.name;

    const input = document.createElement("input");
    input.type = "range";
    input.min = param.min.toString();
    input.max = param.max.toString();
    input.step = ((param.max - param.min) / 100).toString();
    input.value = param.default.toString();

    const value = document.createElement("span");
    value.className = "value";
    value.textContent = param.default.toFixed(2);

    input.addEventListener("input", () => {
      const val = parseFloat(input.value);
      synth?.setParam(param.name, val);
      value.textContent = val.toFixed(2);
    });

    div.appendChild(label);
    div.appendChild(input);
    div.appendChild(value);
    paramsDiv.appendChild(div);
  }
}

/**
 * Generation flow using the backend-proxy pattern:
 *   1. POST to our own proxy with { compositionId, description }
 *   2. Proxy holds the secret key, calls startGeneration, returns streamUrl
 *   3. Browser subscribes to streamUrl (no auth -- jobId is a capability
 *      token) and the SDK auto-loads the finished synth on `ready`.
 */
generateBtn.addEventListener("click", async () => {
  const compositionId = compositionIdInput.value.trim();
  const prompt = promptInput.value.trim();

  if (!compositionId) {
    log("Please enter a composition ID", "warn");
    return;
  }
  if (!prompt) {
    log("Please enter a description", "warn");
    return;
  }
  if (!client) {
    log("Client not initialized", "error");
    return;
  }

  try {
    log(`Generating: "${prompt.slice(0, 50)}..."`);
    generateBtn.disabled = true;

    if (synth && synth.isPlaying()) {
      synth.stop();
    }

    const proxyResp = await fetch(`${PROXY_URL}/proxy/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compositionId, description: prompt }),
    });

    if (!proxyResp.ok) {
      const { error } = await proxyResp
        .json()
        .catch(() => ({ error: `Proxy returned ${proxyResp.status}` }));
      log(`Proxy error: ${error}`, "error");
      return;
    }

    const { streamUrl, host } = (await proxyResp.json()) as {
      streamUrl: string;
      host: string;
    };

    const absolute = /^https?:\/\//i.test(streamUrl) ? streamUrl : `${host}${streamUrl}`;
    for await (const event of client.subscribeToGeneration(absolute, compositionId)) {
      switch (event.type) {
        // `thinking` and `code` fire many times per generation. We
        // intentionally swallow them in this minimal example; real apps
        // would surface them in a streaming "thinking..." panel or a
        // code preview.
        case "thinking":
          break;
        case "progress":
          if (event.content) log(`Phase: ${event.content}`);
          break;
        case "code":
          break;
        case "ready":
          if (!event.synth) break;
          log(`Generated: ${event.synth.name}`, "info");
          synth = event.synth;
          renderParams();
          await synth.play();
          setStatus("Playing", "playing");
          playBtn.disabled = true;
          stopBtn.disabled = false;
          muteBtn.disabled = false;
          loadBtn.disabled = true;
          break;
        case "error":
          log(`Generation failed: ${event.error}`, "error");
          break;
        case "raw":
          break;
      }
    }
  } catch (error) {
    handleError(error, "Generation failed");
  } finally {
    generateBtn.disabled = false;
  }
});

apiKeyInput.value =
  (import.meta.env.VITE_UNDERSCORE_PUBLISHABLE_KEY as string) ||
  localStorage.getItem("underscore-api-key") ||
  "";
compositionIdInput.value =
  (import.meta.env.VITE_UNDERSCORE_COMPOSITION_ID as string) ||
  localStorage.getItem("underscore-composition-id") ||
  "";

apiKeyInput.addEventListener("change", () => {
  localStorage.setItem("underscore-api-key", apiKeyInput.value);
});
compositionIdInput.addEventListener("change", () => {
  localStorage.setItem("underscore-composition-id", compositionIdInput.value);
});

if (import.meta.env.VITE_UNDERSCORE_HOST) {
  log(`Using custom host: ${import.meta.env.VITE_UNDERSCORE_HOST}`, "info");
}
log('Ready. Enter your publishable key (us_pub_...) and click "Initialize Audio".');
log(`Generation proxied via ${PROXY_URL} -- start it with "npm run server".`);
