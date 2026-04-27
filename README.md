# @underscore-audio/sdk

A generative audio SDK for apps, games, and interactive software.

Underscore generates programmable synth systems that your app can play,
stop, and control at runtime — no composer, no audio engine to build.

[![npm version](https://img.shields.io/npm/v/@underscore-audio/sdk)](https://www.npmjs.com/package/@underscore-audio/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

## Smallest Playable Example

Start with [`examples/hello-world/`](./examples/hello-world/) — a single
HTML file with no npm, framework, or build step. Paste in a publishable
key and a public composition ID, serve it with COOP/COEP headers, and
click Play.

## Run the hello-world yourself

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

## Install in your project

```bash
npm install @underscore-audio/sdk supersonic-scsynth
```

The fastest path is the install wizard, which handles the WASM setup and
required server headers automatically:

```bash
npx @underscore-audio/wizard@latest
```

## Embed a public synth (publishable key only)

```typescript
import { Underscore } from "@underscore-audio/sdk";

const client = new Underscore({
  apiKey: "us_pub_...", // publishable key — safe for browser code
  wasmBaseUrl: "/supersonic/",
});

document.getElementById("play").addEventListener("click", async () => {
  await client.init(); // must be inside a user gesture
  const synth = await client.loadSynth("cmp_abc123");
  await synth.play();
});
```

### WASM setup (required for browser playback)

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
for await (const event of client.subscribeToGeneration(streamUrl, compositionId)) {
  if (event.type === "ready") await event.synth?.play();
}
```

The `streamUrl` contains an unguessable `jobId` — the browser subscribes
directly to the Underscore API without credentials.

See [`examples/backend-proxy/`](./examples/backend-proxy/) for the full
working example.

## API keys

| Type        | Prefix    | Where            | Scopes                         |
| ----------- | --------- | ---------------- | ------------------------------ |
| Publishable | `us_pub_` | Browser / client | `synth:read`                   |
| Secret      | `us_sec_` | Server only      | `synth:read`, `synth:generate` |

Sign up at [underscore.audio](https://underscore.audio) — a publishable key
is created automatically.

## API reference

### Client

```typescript
const client = new Underscore({
  apiKey: "us_pub_...",
  wasmBaseUrl: "/supersonic/", // omit when used server-side only
  baseUrl: "https://underscore.audio",
  logLevel: "none", // debug | info | warn | error | none
});

await client.init();
client.isInitialized();
await client.listSynths("cmp_...");
await client.loadSynth("cmp_..."); // first/only synth
await client.loadSynth("cmp_...", "leadVoice"); // pick a named synth
```

### Synth

```typescript
await synth.play();
synth.stop();
synth.isPlaying();

synth.setParam("cutoff", 2000);
synth.setParams({ cutoff: 2000, rate: 0.5 });
synth.resetParams();

synth.name; // string
synth.description; // string
synth.params; // ParamMetadata[]
```

### Errors

```typescript
import { ApiError, AudioError, SynthError, ValidationError } from "@underscore-audio/sdk";

try {
  await client.loadSynth("invalid");
} catch (e) {
  if (e instanceof ApiError) {
    /* HTTP error, e.status */
  }
  if (e instanceof AudioError) {
    /* WASM/WebAudio failure */
  }
  if (e instanceof SynthError) {
    /* playback error */
  }
  if (e instanceof ValidationError) {
    /* schema mismatch */
  }
}
```

## Browser support

Requires SharedArrayBuffer, AudioWorklet, WebAssembly (Chrome 80+,
Firefox 79+, Safari 15.4+, Edge 80+, iOS Safari 15.4+).

## Troubleshooting

| Symptom                 | Fix                                                                     |
| ----------------------- | ----------------------------------------------------------------------- |
| "Audio not initialized" | Call `client.init()` inside a user gesture handler                      |
| WASM not loading        | Run `npx underscore-sdk ./public/supersonic`; confirm COOP/COEP headers |
| No sound                | Check `client.isInitialized()` and `synth.isPlaying()`                  |
| "Composition not found" | Verify `cmp_...` format and that visibility is public                   |

## What is rough / changing

Early SDK. Limited docs. Generation quality varies by prompt. Best
current use case is ambient, reactive, and interactive audio — not
finished pop songs. The generation API is stable; the parameter control
surface may grow.

## Development

```bash
npm install
npm run build
npm test                # mocked unit tests
npm run test:live       # tests against a real Underscore API (see CONTRIBUTING.md)
npm run lint
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](LICENSE)
