# Contributing to @underscore/sdk

Thank you for your interest in contributing to the Underscore SDK.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/underscore-audio/underscore-web-sdk.git
cd underscore-web-sdk

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

## Project Structure

```
src/
  index.ts          # Main entry point, Underscore class
  types.ts          # Public TypeScript types
  schemas.ts        # Zod schemas for API validation
  client.ts         # HTTP client for API requests
  audio.ts          # WebAudio/WASM engine wrapper
  synth.ts          # Synth class for playback control
  generation.ts     # SSE client for generation streaming
  errors.ts         # Custom error classes
  debug.ts          # Logging utilities
  bin/
    copy-assets.ts  # CLI tool for WASM asset copying
examples/           # Complete working example
test/               # Integration tests with mocks
test/live/          # Live tests against a running Underscore API
```

## Code Style

- TypeScript strict mode
- JSDoc comments for public APIs
- Run `npm run lint` before committing
- Run `npm run fmt` to format code

### Pre-commit hook

`npm install` wires up a [husky](https://typicode.github.io/husky/)
pre-commit hook that runs, in order:

1. `lint-staged` -- `eslint --fix` on staged `src/**/*.ts`, and
   `prettier --write` on staged `src/`, `test/`, `examples/`, and
   top-level `*.{json,md,yml,yaml}` files.
2. `npm run typecheck` -- whole-project `tsc --noEmit`.
3. `npm test` -- mocked unit/integration suite (~300ms, no network).

Live tests are never run by the hook: they need credentials and cost
LLM tokens. If you really need to skip the hook (WIP branch, known
broken), use `git commit --no-verify` -- but please don't push such
commits to `main`.

## Testing

```bash
npm test              # Fast, mocked unit + integration tests (no network)
npm run test:watch    # Watch mode
npm run test:coverage # With a v8 coverage report
npm run test:live     # Tests against a real running Underscore API
```

Write tests that assert **observable behavior** through public SDK
methods -- not private internals, not coverage for its own sake. Edge
cases (sad paths, rejected promises, missing environment globals) count
as behavior if they're documented or implied by the public API.

### Live tests

The live suite exercises the SDK against a real API (local or production).
Configuration is entirely through environment variables so the same
harness runs against `http://localhost:3333` (the default when you
`make dev-api` in the monorepo) and `https://underscore.audio`.

| Variable                         | Required for             | Notes                                                                            |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `UNDERSCORE_BASE_URL`            | all                      | Defaults to `http://localhost:3333`. Set to `https://underscore.audio` for prod. |
| `UNDERSCORE_PUBLISHABLE_KEY`     | read-only tier           | `us_pub_...` with `synth:read`.                                                  |
| `UNDERSCORE_TEST_COMPOSITION_ID` | read-only tier           | An unlisted/public composition that owns at least one synth.                     |
| `UNDERSCORE_TEST_SYNTH_NAME`     | optional                 | Defaults to the newest synth in the composition.                                 |
| `UNDERSCORE_SECRET_KEY`          | write + generation tiers | `us_sec_...`.                                                                    |
| `UNDERSCORE_LIVE_GENERATION=1`   | generation tier only     | Opt-in because each run costs LLM tokens and ~30-120s.                           |

Missing variables cause the relevant tests to `skip` with a clear
message, so `npm run test:live` passes on a machine with no credentials.

Example local run:

```bash
export UNDERSCORE_BASE_URL=http://localhost:3333
export UNDERSCORE_PUBLISHABLE_KEY=us_pub_...
export UNDERSCORE_SECRET_KEY=us_sec_...
export UNDERSCORE_TEST_COMPOSITION_ID=cmp_...
# Optional: enable the slow generation tier
export UNDERSCORE_LIVE_GENERATION=1
npm run test:live
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`npm test`) and lint (`npm run lint`)
5. Commit with a clear message
6. Push and open a Pull Request

## Reporting Issues

Use GitHub Issues. Include:

- SDK version
- Browser version
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
