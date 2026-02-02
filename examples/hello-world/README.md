# Hello World - Underscore SDK

A minimal TypeScript example demonstrating all Underscore SDK capabilities.

## Features Demonstrated

1. **Initialize** - Set up the audio engine
2. **Load Synth** - Load a synth from a composition
3. **Playback** - Play, stop, mute/unmute
4. **Parameters** - Real-time parameter control with sliders
5. **Generation** - Create new synths with natural language (AI)
6. **Error Handling** - Typed errors for debugging

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure API key (optional)

Create a `.env` file to avoid entering your API key manually:

```bash
cp .env.example .env
# Edit .env and add your API key
```

Get your API key from [underscore.audio/settings/api](https://underscore.audio/settings/api)

Environment variables:
- `VITE_UNDERSCORE_API_KEY` - Your API key (optional, can enter in UI)
- `VITE_UNDERSCORE_HOST` - API host (default: `https://underscore.audio`)
- `VITE_UNDERSCORE_COMPOSITION_ID` - Default composition ID to test with (optional)

### 3. Copy WASM assets

```bash
npm run copy-assets
```

### 4. Start dev server

```bash
npm run dev
```

Then open http://localhost:5173

## Usage

1. Enter your **API Key** (pre-filled if set in `.env`)
2. Enter a **Composition ID** (create one at underscore.audio)
3. Click **Initialize Audio** (required first - enables WebAudio)
4. Click **Load Synth** to load the latest synth
5. Click **Play** to hear it!
6. Adjust **Parameters** with the sliders
7. Try **Generate** to create a new synth with AI

## Development with Local API

To test against a local Underscore API server:

```bash
# In .env
VITE_UNDERSCORE_HOST=http://localhost:8000
```

## Files

- `main.ts` - TypeScript SDK usage (240 lines, fully typed)
- `index.html` - UI (150 lines)
- `vite.config.ts` - Server config with required headers
- `tsconfig.json` - TypeScript configuration
- `.env.example` - Environment variable template

## Notes

- Written in **TypeScript** with full type safety
- The **Initialize Audio** button must be clicked (browser autoplay policy)
- WASM files must be copied with `npm run copy-assets`
- Server must send COOP/COEP headers (configured in vite.config.ts)
- API key and composition ID are saved to localStorage for convenience
