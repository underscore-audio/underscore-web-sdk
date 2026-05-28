# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-05-28

### Added

- `client.startGeneration(compositionId, description)` - server-side Node
  entry point that kicks off a generation job with a secret key and
  returns `{ jobId, streamUrl }`.
- `client.subscribeToGeneration(streamUrl, options?)` - browser-side
  entry point that subscribes to an in-flight generation stream via SSE.
  Accepts `{ compositionId?, signal? }`; `compositionId` auto-loads the
  finished synth on `ready`, `signal` (AbortSignal) cancels the stream.
  No API key required; the `jobId` in the URL is a capability token.
- `GenerationEvent.type === "raw"` variant as an escape hatch so callers
  can observe unmapped server events without SDK changes.
- `examples/backend-proxy/` - Vite + Express demo of the secure generation
  flow (secret key stays on the server).
- Live integration test suite under `test/live/` (run with `npm run test:live`).
- Pre-commit hook via husky + lint-staged.
- `audio/init-watchdog.ts` and `audio/master-volume.ts` modules extracted
  from the audio engine.

### Changed

- **Breaking:** `Underscore.subscribeToGeneration` and the standalone
  `subscribeToGeneration` function now take an **options bag** as the
  second argument instead of positional `(compositionId?, signal?)`.
  Migrate callers from
  `subscribeToGeneration(url, compositionId, signal)` to
  `subscribeToGeneration(url, { compositionId, signal })`.
- `AudioEngine.loadSamples` now throws `AudioError` when a sample is
  missing `url` instead of silently skipping.
- Consolidated demo and examples into single `examples/` directory.
- Improved README with cleaner structure and tables.

### Fixed

- Parameter type validation now accepts any string (supports custom types like `bpm`, `generic`).
- AbortSignal on generation SSE subscriptions now closes the socket
  immediately on effect teardown (no leaked EventSource connections).

### Removed

- Removed dead `llm.thinking.chunk` / `llm.phase_change` / `llm.code.chunk`
  mapping branches; the server always normalizes these before emitting.
- Removed E2E tests (to be rewritten for standalone repo).
- Removed Playwright dependency.

## [0.1.0] - 2026-01-31

### Added

- Initial release of the Underscore SDK
- `Underscore` class for SDK initialization
- `Synth` class for playback and parameter control
- API client with Zod schema validation
- Generation streaming via Server-Sent Events
- Custom error classes (`ApiError`, `AudioError`, `SynthError`, `ValidationError`)
- Configurable logging (`debug`, `info`, `warn`, `error`, `none`)
- CLI tool (`npx underscore-sdk`) for WASM asset management
- Full TypeScript type definitions
- Working example application

### Technical

- ES2022 target with ESM modules
- Strict TypeScript configuration
- Zod runtime validation
- MSW-based test mocks
