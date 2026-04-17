# @underscore/sdk

TypeScript SDK for integrating [Underscore](https://underscore.audio) AI-generated synthesizers into web applications.

[![npm version](https://img.shields.io/npm/v/@underscore/sdk)](https://www.npmjs.com/package/@underscore/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

## Features

- Load and play AI-generated synthesizers in the browser
- Real-time parameter control
- Generate new synths with natural language
- Full TypeScript support
- Works with React, Vue, Svelte, vanilla JS, and any web framework

## Installation

```bash
npm install @underscore/sdk supersonic-scsynth
```

<details>
<summary>Installing from GitHub (private repo access)</summary>

The SDK lives in its own standalone repo: `underscore-audio/underscore-web-sdk`.

```bash
# Install directly from GitHub
npm install github:underscore-audio/underscore-web-sdk supersonic-scsynth

# Or reference a local clone in your package.json
# "@underscore/sdk": "file:../path/to/underscore-web-sdk"
```
</details>

## Quick Start

```typescript
import { Underscore } from '@underscore/sdk';

const client = new Underscore({
  apiKey: 'us_pub_your_publishable_key',
  wasmBaseUrl: '/supersonic/',
});

// Initialize from user interaction (required by browsers)
document.getElementById('play')?.addEventListener('click', async () => {
  await client.init();
  const synth = await client.loadSynth('cmp_abc123');
  await synth.play();
});
```

## Setup

### 1. Get an API Key

Sign up at [underscore.audio](https://underscore.audio) -- a publishable API key is created for you automatically.

Underscore uses two key types:

| Type | Prefix | Where to use | Scopes |
|------|--------|-------------|--------|
| **Publishable** | `us_pub_` | Browser / client-side code | `synth:read` only |
| **Secret** | `us_sec_` | Server-side only | `synth:read`, `synth:generate` |

Use your **publishable** key in the browser SDK. Use your **secret** key on your server for generating new synths (which consumes LLM credits).

### 2. Copy WASM Assets

```bash
npx underscore-sdk ./public/supersonic
```

### 3. Configure Server Headers

Your server must send these headers for WebAssembly to work:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

<details>
<summary>Vite configuration</summary>

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@underscore/sdk', 'supersonic-scsynth'],
  },
});
```
</details>

<details>
<summary>Next.js configuration</summary>

```javascript
// next.config.js
module.exports = {
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
      ],
    }];
  },
};
```
</details>

## Example

See [`examples/`](./examples/) for a complete working example:

```bash
cd examples
npm install
npm run copy-assets
npm run dev
```

## API Reference

### Client

```typescript
const client = new Underscore({
  apiKey: 'us_pub_...',                  // Required (publishable key for browser)
  wasmBaseUrl: '/supersonic/',           // Required
  baseUrl: 'https://underscore.audio',   // Optional
  logLevel: 'none',                      // Optional: debug | info | warn | error | none
});

await client.init();                     // Initialize audio engine
client.isInitialized();                  // Check status
await client.listSynths('cmp_...');      // List synths in composition
await client.loadSynth('cmp_...', name); // Load synth for playback
```

### Synth

```typescript
await synth.play();                      // Start playback
synth.stop();                            // Stop playback
synth.isPlaying();                       // Check if playing

synth.setParam('cutoff', 2000);          // Set parameter
synth.setParams({ cutoff: 2000 });       // Set multiple
synth.resetParams();                     // Reset to defaults

synth.name;                              // Synth name
synth.description;                       // Description
synth.params;                            // ParamMetadata[]
```

### Generation (backend-proxy pattern, recommended)

Generation consumes LLM credits and requires a **secret** key (`us_sec_...`)
that must never ship to the browser. The SDK splits generation into two
primitives so each half can run in its correct environment.

On your server (Node, holds the secret key):

```typescript
import { Underscore } from '@underscore/sdk';

const server = new Underscore({
  apiKey: process.env.UNDERSCORE_SECRET_KEY!, // us_sec_...
  wasmBaseUrl: 'unused-on-server',
});

// Expose a route your browser can call with { compositionId, description }.
const { jobId, streamUrl } = await server.startGeneration(
  compositionId,
  description
);
// Return { streamUrl } (and optionally the host) to the browser.
```

In the browser (uses a publishable key for read/playback):

```typescript
for await (const event of client.subscribeToGeneration(streamUrl, compositionId)) {
  switch (event.type) {
    case 'thinking': console.log(event.content); break;
    case 'progress': console.log(event.content); break;
    case 'ready':    await event.synth?.play(); break;
    case 'error':    console.error(event.error); break;
    case 'raw':      /* unmapped server event, inspect event.raw */ break;
  }
}
```

The `streamUrl` contains an unguessable `jobId` that acts as a capability
token, so the browser can subscribe without any API key.

### Generation (trusted-environment one-shot)

`client.generate(compositionId, description)` chains both halves in a
single call. It requires BOTH a usable secret key AND an `EventSource`
global, so it's only safe in trusted environments like a Node CLI with
an EventSource polyfill, an Electron app, or a local dev page. Do not
use it in production browser apps -- use the backend-proxy pattern above.

```typescript
for await (const event of client.generate('cmp_...', 'warm analog pad')) {
  // same event shape as subscribeToGeneration
}
```

### Error Handling

```typescript
import { ApiError, AudioError, SynthError, ValidationError } from '@underscore/sdk';

try {
  await client.loadSynth('invalid');
} catch (error) {
  if (error instanceof ApiError) { /* HTTP error */ }
  if (error instanceof ValidationError) { /* Schema mismatch */ }
  if (error instanceof AudioError) { /* WASM/WebAudio error */ }
  if (error instanceof SynthError) { /* Playback error */ }
}
```

## Browser Support

| Browser | Version |
|---------|---------|
| Chrome | 80+ |
| Firefox | 79+ |
| Safari | 15.4+ |
| Edge | 80+ |
| iOS Safari | 15.4+ |

Requires: SharedArrayBuffer, AudioWorklet, WebAssembly

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Audio not initialized" | Call `client.init()` from a click handler |
| WASM not loading | Run `npx underscore-sdk ./public/supersonic` and check headers |
| No sound | Check `client.isInitialized()` and `synth.isPlaying()` |
| "Composition not found" | Verify ID format (`cmp_...`) and visibility settings |

## Development

```bash
npm install     # Install dependencies
npm run build   # Build
npm test        # Run fast mocked tests (no network)
npm run test:live # Run tests against a real Underscore API
npm run lint    # Lint
```

See [CONTRIBUTING.md](./CONTRIBUTING.md#live-tests) for the env vars the
live suite reads; the same harness works against local
(`http://localhost:3333`) and production (`https://underscore.audio`).

## API Compatibility

Compatible with Underscore API v1.

- [API Documentation](https://underscore.audio/docs/web-sdk)
- [API Routes](https://github.com/po-studio/underscore/blob/main/api/src/routes/sdk.ts)

## License

[MIT](LICENSE)
