# @underscore/sdk

TypeScript SDK for loading and playing [Underscore](https://underscore.audio) synths in web applications.

> **Full documentation:** [underscore.audio/docs/web-sdk](https://underscore.audio/docs/web-sdk)

## Installation

### From npm (when published)

```bash
npm install @underscore/sdk supersonic-scsynth
```

### From Private GitHub Repo

Until the SDK is published to npm, install from the GitHub repo:

```bash
# Clone the SDK repo (you need access)
git clone https://github.com/underscore-audio/underscore-web-sdk.git

# In your project's package.json, reference it locally:
# "@underscore/sdk": "file:../path/to/underscore-web-sdk"
```

Or reference it directly via GitHub (if you have access):

```bash
npm install github:underscore-audio/underscore-web-sdk supersonic-scsynth
```

## Quick Start

```typescript
import { Underscore } from '@underscore/sdk';

const client = new Underscore({
  apiKey: 'us_your_api_key',
  wasmBaseUrl: '/supersonic/',
});

// Must be called from user interaction (click/tap)
document.getElementById('play')?.addEventListener('click', async () => {
  await client.init();
  const synth = await client.loadSynth('cmp_abc123');
  await synth.play();
});
```

## Setup Guide

### 1. Get an API Key

Sign up at [underscore.audio](https://underscore.audio) and create an API key in your account settings.

### 2. Install Dependencies

```bash
npm install supersonic-scsynth
# Plus the SDK (see Installation section above)
```

### 3. Copy WASM Assets

The SDK uses WebAssembly for audio synthesis. Copy the required files to your public directory:

```bash
npx underscore-sdk ./public/supersonic
```

This creates:
```
public/supersonic/
  wasm/
    manifest.json
    scsynth-nrt.wasm
  workers/
    scsynth_audio_worklet.js
    (other worker files)
```

### 4. Configure Server Headers

**Required for SharedArrayBuffer/WASM to work:**

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

#### Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Recommended: exclude from optimization
  optimizeDeps: {
    exclude: ['@underscore/sdk', 'supersonic-scsynth'],
  },
});
```

#### Next.js

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

## Complete Example

See [`examples/hello-world/`](./examples/hello-world/) for a minimal working example that demonstrates all SDK capabilities:

- Initialize audio engine
- Load and play synths
- Control parameters in real-time
- Generate new synths with natural language
- Mute/unmute

To run it:

```bash
cd examples/hello-world
npm install
npm run dev
```

## API Reference

### Underscore Client

```typescript
const client = new Underscore({
  apiKey: 'us_...',              // Required
  wasmBaseUrl: '/supersonic/',   // Required: path to WASM files
  baseUrl: 'https://underscore.audio', // Optional (default)
  logLevel: 'none',              // Optional: 'debug' | 'info' | 'warn' | 'error' | 'none'
});

// Initialize audio (call from user gesture)
await client.init();

// Check if initialized
client.isInitialized(); // boolean

// List synths in a composition
const synths = await client.listSynths('cmp_abc123');

// Get synth metadata
const metadata = await client.getSynth('cmp_abc123', 'synth_name');

// Load synth for playback
const synth = await client.loadSynth('cmp_abc123', 'synth_name');
// Or load the latest synth:
const synth = await client.loadSynth('cmp_abc123');
```

### Synth Playback

```typescript
// Play
await synth.play();

// Stop
synth.stop();

// Check state
synth.isPlaying(); // boolean

// Synth metadata
synth.name;        // string
synth.description; // string
synth.params;      // ParamMetadata[]
synth.hasSamples;  // boolean
```

### Parameter Control

```typescript
// Set single parameter
synth.setParam('cutoff', 2000);

// Set multiple parameters
synth.setParams({ cutoff: 2000, resonance: 0.7 });

// Reset to defaults
synth.resetParams();

// Get parameter info
synth.params.forEach(param => {
  console.log(`${param.name}: ${param.min}-${param.max} (default: ${param.default})`);
});
```

### Generation (AI)

Generate new synths using natural language:

```typescript
for await (const event of client.generate('cmp_abc123', 'warm analog pad')) {
  if (event.type === 'thinking') {
    console.log('AI:', event.content);
  } else if (event.type === 'progress') {
    console.log('Phase:', event.content);
  } else if (event.type === 'ready') {
    // event.synth is ready to play
    await event.synth.play();
  } else if (event.type === 'error') {
    console.error('Failed:', event.error);
  }
}
```

### Automation

For advanced parameter automation:

```typescript
import { AutomationRunner } from '@underscore/sdk';

// If the synth has an automation plan
if (synth.automation) {
  const runner = new AutomationRunner(synth, {
    onUpdate: (values) => {
      // values is a Map<string, number> of current param values
    },
    onComplete: () => {
      console.log('Automation finished');
    },
  });
  
  runner.start();
  // runner.stop();
  // runner.seek(timeInSeconds);
}
```

## Error Handling

```typescript
import { ApiError, AudioError, SynthError, ValidationError } from '@underscore/sdk';

try {
  await client.loadSynth('invalid');
} catch (error) {
  if (error instanceof ApiError) {
    // HTTP error (401, 404, etc.)
  } else if (error instanceof ValidationError) {
    // API response didn't match expected schema
  } else if (error instanceof AudioError) {
    // WebAudio/WASM initialization failed
  } else if (error instanceof SynthError) {
    // Synth loading or playback error
  }
}
```

## Troubleshooting

### "Audio not initialized"

Call `client.init()` from a user interaction (click/tap) due to browser autoplay policies.

### WASM files not loading

1. Run `npx underscore-sdk ./public/supersonic`
2. Ensure your server sends the COOP/COEP headers
3. Check browser console for specific errors

### No sound

1. Verify `client.isInitialized()` returns `true`
2. Verify `synth.isPlaying()` returns `true`
3. Check browser audio permissions
4. Check system volume

### "Composition not found"

- Verify the composition ID format: `cmp_...`
- Ensure the composition visibility is "Unlisted" or "Public"
- Verify your API key is valid

## Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 80+ | Full support |
| Firefox | 79+ | Full support |
| Safari | 15.4+ | Full support |
| Edge | 80+ | Full support |
| iOS Safari | 15.4+ | Requires user interaction |

**Required browser features:** SharedArrayBuffer, AudioWorklet, WebAssembly

## Development

```bash
# Install
npm install

# Build
npm run build

# Test
npm test

# Run demo
cd demo && npm install && npm run dev
```

## API Compatibility

This SDK is compatible with Underscore API v1.

- **API Documentation:** [underscore.audio/docs/web-sdk](https://underscore.audio/docs/web-sdk)
- **API Contract:** [github.com/po-studio/underscore/blob/main/api/src/contracts/sdk-api.ts](https://github.com/po-studio/underscore/blob/main/api/src/contracts/sdk-api.ts)

The SDK validates API responses at runtime using Zod schemas. If the API contract changes, the SDK will surface validation errors with clear messages indicating which fields have changed.

## License

MIT
