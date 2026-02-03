# Underscore SDK Example

A complete TypeScript example demonstrating all SDK capabilities.

## Features

- Initialize WebAssembly audio engine
- Load synths from compositions
- Play, stop, and mute controls
- Real-time parameter control with sliders
- AI-powered synth generation
- Error handling

## Quick Start

```bash
# Install dependencies
npm install

# Copy WASM assets (required)
npm run copy-assets

# Start dev server
npm run dev
```

Then open http://localhost:5173

## Configuration

Create a `.env` file (optional):

```bash
cp .env.example .env
```

Environment variables:
- `VITE_UNDERSCORE_API_KEY` - Your API key (or enter in UI)
- `VITE_UNDERSCORE_HOST` - API host (default: `https://underscore.audio`)
- `VITE_UNDERSCORE_COMPOSITION_ID` - Default composition to load

Get your API key at [underscore.audio](https://underscore.audio)

## Project Structure

```
examples/
  main.ts          # SDK usage (fully typed)
  index.html       # UI
  vite.config.ts   # Dev server with required headers
  .env.example     # Environment template
```

## Requirements

- Node.js 18+
- Browser with SharedArrayBuffer support (Chrome 80+, Firefox 79+, Safari 15.4+)
