# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Consolidated demo and examples into single `examples/` directory
- Improved README with cleaner structure and tables
- Updated CONTRIBUTING.md with accurate project structure

### Fixed
- Parameter type validation now accepts any string (supports custom types like `bpm`, `generic`)

### Removed
- Removed E2E tests (to be rewritten for standalone repo)
- Removed Playwright dependency

## [0.1.0] - 2026-01-31

### Added

- Initial release of the Underscore SDK
- `Underscore` class for SDK initialization
- `Synth` class for playback and parameter control
- `AutomationRunner` for keyframe-based parameter automation
- API client with Zod schema validation
- Generation streaming via Server-Sent Events
- Custom error classes (`ApiError`, `AudioError`, `SynthError`, `ValidationError`)
- Configurable logging (`debug`, `info`, `warn`, `error`, `none`)
- CLI tool (`npx underscore-sdk`) for WASM asset management
- Full TypeScript type definitions
- 110 unit and integration tests
- Working example application

### Technical

- ES2022 target with ESM modules
- Strict TypeScript configuration
- Zod runtime validation
- MSW-based test mocks
