# Underscore SDK Example

A complete example demonstrating the SDK using the secure **backend-proxy**
pattern recommended for production apps:

- **Browser** uses a **publishable** key (`us_pub_...`) to list and load
  synths for playback.
- **Server** (a tiny Express app) holds a **secret** key (`us_sec_...`)
  and is the only component that can trigger generation. The browser
  POSTs to the server, which calls `startGeneration` and hands back a
  `streamUrl` the browser can subscribe to.

This keeps the secret key off the wire to the end user while still
allowing rich, streamed generation UX in the browser.

## Quick start

```bash
npm install
npm run copy-assets

# One terminal: the backend proxy (holds the SECRET key)
UNDERSCORE_SECRET_KEY=us_sec_your_secret npm run server

# Another terminal: the browser app (uses the PUBLISHABLE key)
npm run dev
```

Then open http://localhost:5173.

## Environment variables

Browser (Vite -- baked into client bundle):
- `VITE_UNDERSCORE_PUBLISHABLE_KEY` - publishable key (`us_pub_...`). Can
  also be entered in the UI.
- `VITE_UNDERSCORE_HOST` - Underscore API host. Default
  `https://underscore.audio`.
- `VITE_UNDERSCORE_COMPOSITION_ID` - default composition to load.
- `VITE_PROXY_URL` - URL of the backend proxy. Default
  `http://localhost:8787`.

Backend proxy (Node only):
- `UNDERSCORE_SECRET_KEY` - secret key (`us_sec_...`). **Must never be
  exposed to the browser.**
- `UNDERSCORE_HOST` - Underscore API host. Default
  `https://underscore.audio`.
- `PORT` - port for the proxy. Default `8787`.

## Project layout

```
examples/
  index.html        -- browser UI
  main.ts           -- browser SDK usage (publishable key, plus proxy fetch)
  server.ts         -- Express backend proxy (secret key, startGeneration)
  vite.config.ts    -- dev server with required WASM headers
  package.json      -- both browser and server scripts
```

## How generation works

```
Browser (us_pub_)                Backend proxy (us_sec_)           Underscore API
      |                                    |                              |
      |  POST /proxy/generate              |                              |
      | ---------------------------------> |                              |
      |                                    | startGeneration()            |
      |                                    | POST /api/v1/.../generate    |
      |                                    | ---------------------------> |
      |                                    |                              |
      |                                    | <--- { jobId, streamUrl } ---|
      |  <--- { streamUrl, host } ---------|                              |
      |                                    |                              |
      |  new EventSource(host + streamUrl) | (no auth; jobId = capability) |
      | ----------------------------------------------------------------> |
      |                                    |                              |
      |  <----------- SSE events ----------------------------------------- |
```

The `jobId` embedded in `streamUrl` is an unguessable capability token,
so the browser can subscribe directly to the Underscore API without any
credentials. The secret key stays on the server.

## Requirements

- Node.js 18+
- Browser with SharedArrayBuffer support (Chrome 80+, Firefox 79+, Safari 15.4+)
