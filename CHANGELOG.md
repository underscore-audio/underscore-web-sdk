# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-31

### Added

- Initial public release of the Underscore SDK
- `Underscore` class for SDK initialization and configuration
- `Synth` class for synth playback and parameter control
- `AutomationRunner` for executing automation plans with keyframe interpolation
- API client with automatic response validation using Zod schemas
- Generation streaming via SSE for real-time synth creation
- Custom error classes (`ApiError`, `AudioError`, `SynthError`, `ValidationError`)
- Configurable debug logging with log levels
- CLI tool (`underscore-sdk copy-assets`) for WASM asset management
- TypeScript types for all public APIs
- Comprehensive test suite with 110+ tests
- Demo application showcasing SDK features
- React example in documentation

### Technical Details

- TypeScript SDK targeting ES2022
- Strict TypeScript configuration with full type safety
- Runtime validation of API responses using Zod
- MSW-based integration tests
- Playwright E2E tests for demo app
- ESLint with recommended TypeScript rules
- Prettier for consistent code formatting
