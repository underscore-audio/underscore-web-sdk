# Contributing to @underscore/sdk

Thank you for your interest in contributing to the Underscore SDK.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/underscore-audio/underscore-sdk.git
cd underscore-sdk

# Install dependencies
npm install

# Build the SDK
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Project Structure

```
src/
  index.ts          # Main entry point, Underscore class
  types.ts          # Public TypeScript types
  client.ts         # HTTP client for API requests
  audio.ts          # WebAudio/WASM engine wrapper
  synth.ts          # Synth class for playback control
  generation.ts     # SSE client for generation streaming
  bin/
    copy-assets.ts  # CLI tool for WASM asset copying
demo/               # Interactive demo application
```

## Code Style

- Use TypeScript strict mode
- Use JSDoc comments for public APIs
- Run `npm run lint` before committing
- Run `npm run fmt` to format code

## Testing

Tests use Vitest. Run them with:

```bash
npm test           # Run once
npm run test:watch # Watch mode
```

Note: Some tests require a browser environment with WebAudio support. 
The test suite mocks browser APIs where possible.

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Reporting Issues

Please use GitHub Issues to report bugs or request features. Include:

- SDK version
- Browser/Node version
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
