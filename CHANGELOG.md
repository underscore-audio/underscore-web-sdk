# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Programs: multi-synth piece playback.** A program is a complete
  timed piece — several SynthDefs, a routing graph, and a beat-stamped
  event timeline — captured as a manifest. New API surface:
  - `underscore.listPrograms(compositionId)` returns program summaries
    (title, bpm, duration, sections) without the heavy manifest.
  - `underscore.getProgramManifest(compositionId, name)` fetches and
    validates a full manifest.
  - `underscore.loadProgram(compositionId, name?)` fetches the manifest
    plus every SynthDef it names, loads them into the audio engine, and
    returns a `Program` handle. Omitting `name` loads the latest
    program.
  - `Program` supports `play(atBeat?)`, `stop()`, `seek(beat)`,
    `seekToSection(index)`, `isPlaying()`, and `subscribe(listener)`
    for ~10 Hz progress snapshots (beat, seconds, section, progress).
    Seeking replays the cumulative control state up to the target beat,
    so a mid-piece entry sounds the way it would if the piece had
    played from the start.
- Playback is exclusive per client: starting a program stops
  single-synth playback and vice versa, so a page never double-plays.
- Program schemas (`ProgramManifest`, `ProgramSummary`, and friends)
  are exported both as types and as Zod schemas.

### Changed

- The backend version pin (`.underscore-version`) now points at the
  backend commit that introduces the `/api/v1/compositions/{id}/programs`
  endpoints, and the generated contract (types, schemas, OpenAPI) picks
  up the new program shapes plus a `programCount` field on
  `Composition`. Existing synth endpoints no longer return program
  records; they were never loadable as single synths.
- The backend version pin (`.underscore-version`) now points at the
  current backend main. The `/api/v1` request/response shapes are
  unchanged; the backend now enforces stricter checks behind them
  (composition ownership on reuse, content validation on generation
  inputs, asset allowlisting), all of which surface through the
  existing `ApiError` with the server's status and message.
- Generation error-path tests now assert the `ApiError.status` and
  server-provided message rather than just the error type.

## [0.5.0] - 2026-07-21

### Changed

- **Breaking:** supersonic peer range is now `>=0.70.0 <1.0.0` (was
  `^0.14.0`), and `supersonic-scsynth-core` is a new peer dependency.
  Upstream split the runtime in 0.6x into `supersonic-scsynth` (JS
  client + OSC workers) and `supersonic-scsynth-core` (scsynth WASM +
  AudioWorklet); the old range made the SDK uninstallable next to any
  current supersonic release.
- The audio engine speaks the 0.70 supersonic API: engine options are
  passed to the `SuperSonic` constructor (with `coreBaseURL` derived
  from `wasmBaseUrl`), `init()` takes no arguments, and the master
  volume splice uses the public `node` routing seam instead of the
  private `workletNode` field. The SDK's public config (`wasmBaseUrl`,
  `workerBaseUrl`) is unchanged.
- `npx underscore-sdk <dir>` (copy-assets) now copies from both
  packages, producing `wasm/` (engine from supersonic-scsynth-core)
  and `workers/` (OSC workers + AudioWorklet) under the target
  directory, and resolves package locations through Node resolution
  instead of fixed node_modules paths.
- Synthdef bytes are passed to the engine directly instead of through
  a base64 `data:` URL; 0.70 accepts `ArrayBuffer` input natively.
- The install wizard installs all three packages
  (`@underscore-audio/sdk`, `supersonic-scsynth`,
  `supersonic-scsynth-core`) with ranges read from the SDK's
  `peerDependencies` (wizard 0.2.0).
- Sample bytes (`loadSampleFromData`) are passed to the engine
  directly, matching the synthdef path; the Blob/`createObjectURL`
  detour is gone.

## [0.4.0] - 2026-07-21

### Added

- Generation tuning knobs on the generate request. `startGeneration`
  (both the standalone function and the `Underscore` method) and the
  legacy `generate` flow accept optional `complexity`
  (`"fast" | "balanced" | "rich"`) and `model` fields. `complexity`
  trades generation speed against musical richness; `model` pins a
  specific backend model. Omitting both preserves the previous
  single-shot behavior, so existing callers are unaffected.
- Server `status` and `repair_started` stream events are now mapped to
  first-class `progress` events (previously surfaced as `raw`), so
  progress UIs see compile-retry and repair feedback without touching
  the unversioned `raw` payload.

### Changed

- The backend version pin (`.underscore-version`) now points at the
  currently deployed backend, so the cross-repo contract and e2e gates
  test against reality instead of an April snapshot.

### Removed

- Dead mapping for the retired `declined` stream event. The server no
  longer emits it; declined requests arrive as regular `error` events.
  `declined` payloads from older servers now fall through to `raw`.

## [0.3.0] - 2026-05-28

### Changed

- Score scheduler now honours the `curve` field on each `ScoreEvent`.
  Previously every event was treated as a `step` jump regardless of
  what the generated score asked for. `linear` and `exp` events now
  ramp each numeric param from its prior value (or the synth's
  default at t=0) to the target across the gap between events,
  emitting intermediate `setParams` calls so slow filter sweeps and
  amp fades sound continuous instead of stepped. `step` keeps the
  previous one-shot behaviour and remains the default. The public
  API surface is unchanged.

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
- `examples/server.ts` - tiny Express backend proxy demonstrating the
  secure generation flow (secret key stays on the server).
- Live integration test suite under `test/live/` (run with `npm run test:live`).
  Exercises a real running Underscore API (local or production) selected via
  `UNDERSCORE_BASE_URL`; credentials come from `UNDERSCORE_PUBLISHABLE_KEY`
  and `UNDERSCORE_SECRET_KEY`. The slow generation tier is gated behind
  `UNDERSCORE_LIVE_GENERATION=1`. Missing env vars skip cleanly so
  `npm run test:live` is safe to run on forks without credentials.
- Pre-commit hook via husky + lint-staged: runs `eslint --fix` + prettier
  on staged files, then `typecheck` and the mocked test suite. Bypass
  with `git commit --no-verify` when necessary. See CONTRIBUTING.md.

### Changed

- `AudioEngine.loadSamples` now throws `AudioError` when a sample is
  missing `url` instead of silently skipping. Surfaces API/SDK contract
  breaks immediately rather than producing a silent synth.
- Consolidated demo and examples into single `examples/` directory.
- Improved README with cleaner structure and tables.
- Updated CONTRIBUTING.md with accurate project structure.

### Fixed

- Parameter type validation now accepts any string (supports custom types like `bpm`, `generic`).

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
