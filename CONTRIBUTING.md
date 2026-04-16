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
```

## Code Style

- TypeScript strict mode
- JSDoc comments for public APIs
- Run `npm run lint` before committing
- Run `npm run fmt` to format code

## Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
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
