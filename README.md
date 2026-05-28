# @underscore-audio/sdk

A generative audio SDK for apps, games, and interactive software.

[![npm version](https://img.shields.io/npm/v/@underscore-audio/sdk)](https://www.npmjs.com/package/@underscore-audio/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

Backed by [underscore.audio](https://underscore.audio) — the hosted
Underscore backend powering this SDK.

## What is Underscore

Music as code, not files. Describe a sound, get a programmable synth
your app drives at runtime — start it, stop it, and modulate its
parameters in response to anything that happens in your code. Runs in
any modern browser via WebAssembly (SuperCollider compiled to WASM).

Sign up and create your first synth at
[underscore.audio](https://underscore.audio); the dashboard hands you a
publishable API key and a composition ID you can paste into the example
below.

## Smallest playable example

Start with [`examples/hello-world/`](./examples/hello-world/) — a single
HTML file with no npm, framework, or build step. Paste in a publishable
key and a public composition ID, serve it with COOP/COEP headers, and
click Play.

```bash
git clone https://github.com/underscore-audio/underscore-web-sdk
cd underscore-web-sdk/examples/hello-world
# fill in DEMO_KEY and DEMO_COMP in index.html, then:
npx http-server . -p 8080 \
  --header "Cross-Origin-Opener-Policy: same-origin" \
  --header "Cross-Origin-Embedder-Policy: require-corp"
# open http://localhost:8080
```

The HTML file imports the SDK from a CDN and loads WASM from
underscore.audio — nothing to install. The two headers are required by
browsers for SharedArrayBuffer (which the WASM audio engine needs).

## Install

```bash
npm install @underscore-audio/sdk supersonic-scsynth
```

The fastest path is the install wizard, which handles the WASM setup
and required server headers automatically:

```bash
npx @underscore-audio/wizard@latest
```

## Quickstart (browser, publishable key)

```typescript
import { Underscore } from "@underscore-audio/sdk";

const client = new Underscore({
  apiKey: "us_pub_...", // publishable key — safe for browser code
  wasmBaseUrl: "/supersonic/",
});

document.getElementById("play").addEventListener("click", async () => {
  await client.init(); // MUST be inside a user gesture
  const synth = await client.loadSynth("cmp_abc123");
  await synth.play();
});
```

`wasmBaseUrl` must point to the directory where you copied the
`supersonic-scsynth` runtime files (see [WASM setup](#wasm-setup)
below).

`init()` must be called from inside a user-gesture handler (click, tap,
keydown). Browser autoplay policy holds the `AudioContext` in a
suspended state until a real user gesture, and Underscore's audio
engine cannot start until the context is running. The SDK enforces
this with a 10-second watchdog: if `init()` is called outside a gesture
(or any time the `AudioContext` cannot transition to `running`), the
returned promise rejects with an `AudioError` ("Audio engine init() did
not complete within 10000ms...") and the SDK clears its internal init
state so a retry from inside a real gesture handler starts fresh.

## WASM setup

Copy the WASM and audio worker files to your public directory:

```bash
npx underscore-sdk ./public/supersonic
```

Add these headers to your dev server and production server:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

<details>
<summary>Vite</summary>

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: { exclude: ["@underscore-audio/sdk", "supersonic-scsynth"] },
});
```

</details>

<details>
<summary>Next.js</summary>

```javascript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};
```

</details>

## Generate new synths through a backend proxy

Generation consumes LLM credits and requires a secret key that must
never ship to the browser. The SDK splits generation into two calls so
each half runs in the right environment.

**On your server** (holds the secret key):

```typescript
import { Underscore } from "@underscore-audio/sdk";

const server = new Underscore({ apiKey: process.env.UNDERSCORE_SECRET_KEY });

app.post("/generate", async (req, res) => {
  const { jobId, streamUrl } = await server.startGeneration(
    req.body.compositionId,
    req.body.description
  );
  res.json({ streamUrl });
});
```

**In the browser** (publishable key, playback only):

```typescript
for await (const event of client.subscribeToGeneration(streamUrl, { compositionId })) {
  switch (event.type) {
    case "thinking":
      /* event.content: partial LLM reasoning */ break;
    case "progress":
      /* event.content: phase label, e.g. "compiling" */ break;
    case "code":
      /* event.content: streaming SuperCollider code chunk */ break;
    case "ready":
      await event.synth?.play();
      break;
    case "error":
      /* event.error: failure message */ break;
    case "raw":
      /* event.raw: unmapped server payload (escape hatch) */ break;
  }
}
```

The `streamUrl` contains an unguessable `jobId` — the browser
subscribes directly to the Underscore API without credentials. When
you pass a `compositionId` to `subscribeToGeneration`, the SDK
auto-loads the finished synth on the terminal `ready` event and
attaches it as `event.synth` so you can immediately call `.play()`.

To cancel a subscription early (effect cleanup, navigation, watchdog
timeout), pass an `AbortSignal`. Aborting closes the SSE socket and
ends the generator:

```typescript
const controller = new AbortController();
const iter = client.subscribeToGeneration(streamUrl, {
  compositionId,
  signal: controller.signal,
});
// ...
controller.abort(); // closes the stream and ends the for-await
```

See [`examples/backend-proxy/`](./examples/backend-proxy/) for the
full working example.

## API surface

### Configuration

```typescript
interface UnderscoreConfig {
  apiKey: string; // "us_pub_..." (browser) or "us_sec_..." (server)
  baseUrl?: string; // defaults to "https://underscore.audio"
  wasmBaseUrl?: string; // defaults to "/supersonic/"; only consumed on init()/loadSynth()
  workerBaseUrl?: string; // defaults to wasmBaseUrl + "workers/"
  logLevel?: "debug" | "info" | "warn" | "error" | "none"; // defaults to "none"
}
```

`wasmBaseUrl` and `workerBaseUrl` are only read when the audio engine
starts. Server-side Node usage (e.g. calling `startGeneration` from a
backend proxy) never touches the audio engine, so they can be omitted
there.

### `Underscore` client

| Method                                        | Signature                                                                                                     | Returns / Throws                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init()`                                      | `() => Promise<void>`                                                                                         | Resolves once the WASM audio engine is running. Rejects with `AudioError` if not called from a user gesture (10s watchdog).                                                                                            |
| `isInitialized()`                             | `() => boolean`                                                                                               | `true` once `init()` has resolved.                                                                                                                                                                                     |
| `loadSynth(compositionId, synthName?)`        | `(string, string?) => Promise<Synth>`                                                                         | Resolves to a playable `Synth`. Defaults to the latest synth in the composition when `synthName` is omitted. Throws `ApiError` (HTTP), `ValidationError` (schema), `AudioError` (engine), or `SynthError` (no synths). |
| `listSynths(compositionId)`                   | `(string) => Promise<SynthSummary[]>`                                                                         | All synths in the composition. Throws `ApiError`, `ValidationError`.                                                                                                                                                   |
| `getSynth(compositionId, synthName)`          | `(string, string) => Promise<SynthMetadata>`                                                                  | Full metadata including samples + synthdef URL.                                                                                                                                                                        |
| `getComposition(compositionId)`               | `(string) => Promise<Composition>`                                                                            | Composition metadata.                                                                                                                                                                                                  |
| `createComposition(options?)`                 | `(CreateCompositionOptions?) => Promise<CreateCompositionResponse>`                                           | Server-only (requires secret key).                                                                                                                                                                                     |
| `startGeneration(compositionId, description)` | `(string, string) => Promise<{ jobId, streamUrl }>`                                                           | Server-only. Kicks off a generation job; returns the unguessable `jobId` and a relative `streamUrl` to forward to the browser. Throws `ApiError`.                                                                      |
| `subscribeToGeneration(streamUrl, options?)`  | `(string, { compositionId?: string; signal?: AbortSignal }?) => AsyncGenerator<GenerationEvent & { synth? }>` | Browser-only. Yields events from the SSE stream. When `options.compositionId` is provided, auto-loads the finished synth on `ready`. `options.signal` cancels the subscription.                                        |
| `generate(compositionId, description)`        | `(string, string) => AsyncGenerator<GenerationEvent & { synth? }>`                                            | Legacy combined flow. Only safe in trusted environments that can use a secret key AND have an `EventSource` global (Node CLI w/ polyfill, Electron). Browser apps must use the two-call pattern above.                 |
| `setMasterVolume(value)`                      | `(number) => void`                                                                                            | Output bus gain in `[0, 2]`. Out-of-range values clamp with a console warning. Non-finite values throw `ValidationError`. Safe to call before `init()` (cached and applied on init).                                   |
| `getMasterVolume()`                           | `() => number`                                                                                                | Current (clamped) master gain. Defaults to `1.0`.                                                                                                                                                                      |
| `audioContext` (getter)                       | `AudioContext \| null`                                                                                        | Underlying `AudioContext` once initialized; `null` before. Useful for advanced routing.                                                                                                                                |

`shutdown()` is not currently part of the public client API; let the
client be garbage-collected when you're done with it.

### `Synth`

```typescript
class Synth {
  // identity
  readonly compositionId: string;
  readonly name: string;
  readonly description: string;
  readonly params: ParamMetadata[];
  readonly samples: SampleMetadata[] | undefined;

  // playback
  play(): Promise<void>; // throws SynthError if not loaded
  stop(): void;
  isPlaying(): boolean;

  // parameters (clamped to each param's [min, max])
  setParam(name: string, value: number): void;
  setParams(params: Record<string, number>): void;
  getParam(name: string): number | undefined;
  getAllParams(): Record<string, number>;
  resetParams(): void;

  // crossfade between synths (both run during the transition)
  crossfadeIn(durationSec?: number): Promise<void>; // default 3s
  isCrossfading(): boolean;

  // observe play/stop/param state
  subscribe(listener: (state: SynthState) => void): () => void;
}
```

`ParamMetadata` (returned in `synth.params`) is the contract you
build UI around:

```typescript
interface ParamMetadata {
  name: string; // OSC arg name
  type: ParamType; // "freq" | "amp" | "time" | "rate" | ... (UI hint)
  default: number;
  min: number;
  max: number;
  scale?: ParamScale; // "linear" (default) | "log" | "exp" | ...
  unit?: string; // "Hz", "ms", "dB", ...
  description: string;
}
```

### `GenerationEvent` (streaming events)

`subscribeToGeneration` yields a discriminated union; check
`event.type` and read the field documented for that variant.

| `type`     | Field                             | Meaning                                                                                                        |
| ---------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `thinking` | `content` (partial text)          | LLM reasoning chunk.                                                                                           |
| `progress` | `content` (phase label)           | Phase/status change, e.g. `"compiling"`, `"Created synth: bassDrone"`.                                         |
| `code`     | `content` (partial text)          | Streaming SuperCollider code chunk. Useful for live previews.                                                  |
| `ready`    | `synthName`, optional `synth`     | Generation complete. When the SDK was given a `compositionId`, `synth` is a loaded `Synth` ready to `.play()`. |
| `error`    | `error` (string)                  | Generation failed, declined, or the SSE connection dropped.                                                    |
| `raw`      | `raw` (`Record<string, unknown>`) | Unmapped server event. Escape hatch for power users; shape is unversioned.                                     |

### Errors

```typescript
import {
  UnderscoreError, // base class
  ApiError, // .status: number (HTTP code)
  AudioError, // WASM/WebAudio failures, including the 10s init watchdog
  SynthError, // synth playback / lifecycle errors
  ValidationError, // .issues: unknown[] (Zod issues from API responses)
} from "@underscore-audio/sdk";
```

| Class             | Thrown when                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiError`        | HTTP request to the Underscore API fails. Carries `status`.                                                                                                 |
| `AudioError`      | Audio engine cannot start (e.g. autoplay-suspended `AudioContext` past the 10s watchdog), missing sample URL, or `init()` was never called before `play()`. |
| `SynthError`      | `play()` called on an unloaded synth, or `loadSynth()` ran against a composition with zero synths.                                                          |
| `ValidationError` | API response failed Zod schema validation (most often a server contract drift). Carries `issues`.                                                           |

## API key reference

| Type        | Prefix    | Where            | Scopes                         |
| ----------- | --------- | ---------------- | ------------------------------ |
| Publishable | `us_pub_` | Browser / client | `synth:read`                   |
| Secret      | `us_sec_` | Server only      | `synth:read`, `synth:generate` |

Issued from the [underscore.audio](https://underscore.audio) dashboard
on signup.

## Browser support

Requires SharedArrayBuffer, AudioWorklet, and WebAssembly: Chrome 80+,
Firefox 79+, Safari 15.4+, Edge 80+, iOS Safari 15.4+. SharedArrayBuffer
needs cross-origin isolation, which is why COOP/COEP are mandatory.

## Troubleshooting

| Symptom                                                              | Fix                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AudioError: Audio engine init() did not complete within 10000ms...` | Call `client.init()` from inside a click handler or other user gesture.                  |
| `Audio not initialized` on `play()`                                  | `await client.init()` before `loadSynth()` / `play()`.                                   |
| WASM not loading                                                     | Run `npx underscore-sdk ./public/supersonic`; confirm COOP/COEP headers are set.         |
| No sound                                                             | Check `client.isInitialized()`, `synth.isPlaying()`, and `getMasterVolume()`.            |
| `Composition not found`                                              | Verify `cmp_...` format and that the composition's visibility is `public` or `unlisted`. |
| `ValidationError` from any client method                             | Your installed SDK is older than the API contract; update `@underscore-audio/sdk`.       |

## What is rough / changing

Early SDK. Limited docs. Generation quality varies by prompt. Best
current use case is ambient, reactive, and interactive audio — not
finished pop songs. The generation API is stable; the parameter
control surface and the `raw` generation-event payload may grow.

## Pair this with your own backend (optional)

You don't have to use the hosted Underscore backend. The SDK speaks a
documented HTTP+SSE contract, so a self-hosted server can stand in for
[underscore.audio](https://underscore.audio) as long as it implements
the contract below. This section is a pointer, not a full spec — open
an issue if you want the long-form self-host documentation.

Minimum viable contract:

- **Auth header.** All requests carry `Underscore-API-Key: <key>`.
  Publishable keys (`us_pub_*`) get `synth:read`; secret keys
  (`us_sec_*`) additionally get `synth:generate`.
- **`GET /api/v1/compositions/:compositionId`** — returns composition
  metadata (`Composition` shape).
- **`GET /api/v1/compositions/:compositionId/synths`** — returns
  `{ synths: SynthSummary[] }`.
- **`GET /api/v1/compositions/:compositionId/synths/:synthName`** —
  returns `SynthMetadata`, including a `synthdefUrl` and any signed
  sample URLs the SDK should fetch.
- **`GET /api/v1/compositions/:compositionId/synths/:synthName/synthdef`** —
  returns the compiled synthdef as raw bytes.
- **`POST /api/v1/compositions/:compositionId/generate`** (secret key
  required) — body `{ description }`, returns `{ jobId, streamUrl }`.
  `streamUrl` is the relative path the browser will subscribe to.
- **SSE stream at `streamUrl`** — emits the server-side event types
  the SDK maps into the `GenerationEvent` union (`thinking`,
  `phase_change`, `code`, `synth_created`, `complete`, `error`,
  `declined`). `jobId` is the only auth — it is treated as a
  capability token, so the URL must be unguessable.

The TypeScript types in `src/types.ts` and the Zod schemas in
`src/schemas.ts` are the canonical contract.

## Development

```bash
npm install
npm run build
npm test                # mocked unit + integration suite (no network)
npm run test:watch
npm run test:coverage
npm run test:live       # exercises the SDK against a real Underscore API
npm run lint
```

The live test suite is configured entirely through environment
variables and skips cleanly when credentials are absent. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the full variable list and the
maintainer-only CI live-test setup.

### Or via `make`

A `Makefile` is provided as a parallel surface — handy if you work
across multiple repos that share the same conventional verbs:

```bash
make setup     # npm install (root + packages/wizard)
make build     # build SDK and wizard
make test      # SDK mocked + wizard mocked + live (live skips without creds)
make lint      # lint SDK and wizard
make fmt       # prettier --write .
make clean     # remove dist/ and packages/wizard/dist/
```

`npm` is the canonical surface for external contributors; the make
targets just forward to the same scripts and keep day-to-day commands
identical across sibling projects.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](LICENSE)
