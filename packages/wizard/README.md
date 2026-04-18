# @underscore/wizard

Install and configure [Underscore](https://underscore.audio) in an existing web
project in under five minutes.

```bash
npx @underscore/wizard@latest
```

The wizard:

1. Signs you in (or creates an account) through a browser device-code flow.
2. Provisions a publishable API key for your new integration.
3. Detects your framework (Vite, Next.js, or vanilla HTML) and package manager.
4. Installs `@underscore/sdk` and `supersonic-scsynth` and copies the WASM assets
   into your public directory.
5. Patches your build config with the required COOP/COEP headers.
6. Writes your API key to `.env.local` (or `.env`) without touching existing
   values.
7. Looks at a few files in your project to pick a handful of starter sounds that
   match the vibe of your app, and scaffolds a small working example.

The wizard never uploads your code. It reads a small number of local files to
pick keyword hints and calls the public Underscore discover endpoint with those
tags.

## Development

```bash
# From packages/wizard
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

The wizard ships as a standalone package alongside `@underscore/sdk`. The
published `bin` is `underscore-wizard`, invoked via
`npx @underscore/wizard@latest`.

## Exit codes

- `0` - installation completed successfully
- `1` - user cancelled or a step failed; state is rolled back where possible

## Safety model

- All file mutations are shown to the user before they happen.
- Existing env vars with the same key are never overwritten without a confirm.
- Build config patches use AST-safe rewrites via `magicast` and fall back to
  printing the manual change if the file is too unusual to edit safely.
