# hello-world

Single-file Underscore SDK demo. No npm, no framework, no build step.

Open `index.html` — one button plays a curated synth pulled live from
the Underscore API. The SDK and WASM load from CDN and underscore.audio
respectively, so there is nothing to install.

## Before you run it

Edit the two constants at the top of the `<script>` block in `index.html`:

```js
const DEMO_KEY = "us_pub_REPLACE_ME"; // publishable key from underscore.audio
const DEMO_COMP = "cmp_REPLACE_ME"; // ID of the public composition to play
```

A publishable key has `synth:read` scope only — it is safe to ship in
browser code.

## Run locally

The page requires `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` to enable SharedArrayBuffer
(needed by the WASM audio engine). Any server that sets those headers works:

```bash
# Node (npx serve doesn't set COOP/COEP, use this instead)
npx http-server . -p 8080 --cors \
  --header "Cross-Origin-Opener-Policy: same-origin" \
  --header "Cross-Origin-Embedder-Policy: require-corp"
```

Then open http://localhost:8080.

## Static hosting

This example is just static files, so it can live in this repo and still be
copied into any static host later. The `_headers` file is included for hosts
that understand Cloudflare Pages-style headers; otherwise configure the same
COOP/COEP headers in your host or CDN.
