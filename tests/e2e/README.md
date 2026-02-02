# End-to-End Test Suite

This directory contains comprehensive end-to-end tests that validate the complete developer experience documented in our SDK documentation.

## Test Coverage

### 1. **full-journey.test.ts**
Tests the complete flow from API key to audio playback:
- SDK installation and setup
- Composition creation
- Synth generation
- Listing and loading synths
- Audio playback
- Parameter control
- Error handling

### 2. **browser-audio.test.ts**
Tests audio functionality in a real browser using Playwright:
- Audio context initialization from user interaction
- WASM file loading
- Real audio playback
- Parameter changes during playback
- State subscriptions
- Cross-origin security headers

### 3. **docs-validation.test.ts**
Validates documentation accuracy:
- README completeness
- Getting Started guide
- Quickstart guide
- API reference documentation
- Code example syntax
- Cross-reference consistency

## Prerequisites

### Manual Steps (Cannot be Automated)

1. **Create an Underscore Account**
   - Go to https://underscore.audio
   - Sign up for an account
   - Verify your email

2. **Create an API Key**
   - Log in to https://underscore.audio
   - Go to Settings
   - Click "Create API Key"
   - Name: "E2E Test Key"
   - Scopes: `synth:read`, `synth:generate`
   - Copy the key (starts with `us_...`)

3. **Create a Test Composition** (optional, for browser tests)
   - Log in to the web app
   - Generate at least one synth
   - Note the composition ID (starts with `cmp_...`)
   - Set visibility to "Unlisted"

## Setup

### 1. Install Dependencies

```bash
cd packages/sdk
npm install
npm install --save-dev vitest @playwright/test
```

### 2. Build the SDK

```bash
npm run build
```

### 3. Set Environment Variables

Create a `.env.test` file in `packages/sdk/`:

```bash
# Required for all tests
UNDERSCORE_API_KEY=us_your_actual_api_key_here

# Optional - for testing against local dev server
UNDERSCORE_API_URL=http://localhost:3333

# Optional - for browser tests with existing composition
UNDERSCORE_COMPOSITION_ID=cmp_your_composition_id
```

### 4. Install Playwright Browsers (for browser tests)

```bash
npx playwright install
```

## Running Tests

### Run All E2E Tests

```bash
npm run test:e2e
```

### Run Individual Test Suites

```bash
# Full journey test (API-based)
npx vitest run tests/e2e/full-journey.test.ts

# Documentation validation
npx vitest run tests/e2e/docs-validation.test.ts

# Browser audio tests (requires Playwright)
npx playwright test tests/e2e/browser-audio.test.ts
```

### Run with Verbose Output

```bash
npx vitest run tests/e2e/full-journey.test.ts --reporter=verbose
```

### Run in Watch Mode

```bash
npx vitest watch tests/e2e/docs-validation.test.ts
```

## Test Workflow

### What Gets Tested

✅ **Account Creation** - Documented in Getting Started (manual step)
✅ **API Key Creation** - Documented in Getting Started (manual step)
✅ **SDK Installation** - Automated test
✅ **Composition Creation** - Automated test via API
✅ **Synth Generation** - Automated test via API
✅ **List Synths** - Automated test
✅ **Load Synth** - Automated test
✅ **Audio Playback** - Browser test (Playwright)
✅ **Parameter Control** - Browser test
✅ **Error Handling** - Automated tests
✅ **Documentation Accuracy** - Automated validation

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   3rd Party Developer                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │  1. Read Getting Started      │
            │     - Create account          │  ← Validated by docs-validation.test.ts
            │     - Generate synth in UI    │
            │     - Get API key             │
            │     - Set visibility          │
            └───────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │  2. Read README/Quickstart    │
            │     - npm install             │  ← Validated by docs-validation.test.ts
            │     - Copy WASM assets        │
            │     - Configure server        │
            └───────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │  3. Initialize SDK            │
            │     - new Underscore()        │  ← Tested by full-journey.test.ts
            │     - Verify API key          │
            └───────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │  4. Create Composition        │
            │     - POST /api/v1/...        │  ← Tested by full-journey.test.ts
            │     - Set visibility          │
            └───────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │  5. Generate Synth            │
            │     - client.generate()       │  ← Tested by full-journey.test.ts
            │     - Wait for completion     │
            └───────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │  6. Load Synth                │
            │     - client.loadSynth()      │  ← Tested by full-journey.test.ts
            │     - Get parameters          │     and browser-audio.test.ts
            └───────────────────────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │  7. Play Audio                │
            │     - client.init()           │  ← Tested by browser-audio.test.ts
            │     - synth.play()            │
            │     - synth.setParam()        │
            │     - synth.stop()            │
            └───────────────────────────────┘
```

## Expected Results

### Success Criteria

All tests should pass and output:
- ✅ SDK client initialized
- ✅ API key format valid
- ✅ Composition created
- ✅ Synth generated
- ✅ Synth loaded
- ✅ Parameters controllable
- ✅ Error handling works
- ✅ Documentation complete and accurate

### Common Failures

#### "UNDERSCORE_API_KEY environment variable is required"
- **Cause**: API key not set
- **Fix**: Create `.env.test` with your API key

#### "Synth generation timed out"
- **Cause**: Generation taking longer than 60 seconds
- **Fix**: Increase timeout or check API server

#### "SharedArrayBuffer is not defined"
- **Cause**: Missing security headers in test environment
- **Fix**: Ensure Vite dev server has correct headers configured

#### "Audio not initialized" in browser tests
- **Cause**: No user interaction simulated
- **Fix**: Playwright tests simulate clicks before audio init

## Continuous Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: |
          cd packages/sdk
          npm install

      - name: Build SDK
        run: |
          cd packages/sdk
          npm run build

      - name: Run documentation validation
        run: |
          cd packages/sdk
          npx vitest run tests/e2e/docs-validation.test.ts

      - name: Run API tests
        env:
          UNDERSCORE_API_KEY: ${{ secrets.E2E_API_KEY }}
          UNDERSCORE_API_URL: ${{ secrets.E2E_API_URL }}
        run: |
          cd packages/sdk
          npx vitest run tests/e2e/full-journey.test.ts

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Run browser tests
        env:
          UNDERSCORE_API_KEY: ${{ secrets.E2E_API_KEY }}
          UNDERSCORE_COMPOSITION_ID: ${{ secrets.E2E_COMPOSITION_ID }}
        run: |
          cd packages/sdk
          npx playwright test tests/e2e/browser-audio.test.ts
```

## Manual Testing Checklist

In addition to automated tests, manually verify:

- [ ] Can create account at underscore.audio
- [ ] Can log in successfully
- [ ] Can generate synths via web UI
- [ ] Can create API key in Settings
- [ ] Can copy API key to clipboard
- [ ] Can set composition visibility
- [ ] README is clear for first-time users
- [ ] Code examples can be copy-pasted and work
- [ ] Error messages are helpful
- [ ] Documentation links all work

## Maintenance

### Updating Tests When Docs Change

1. Update `docs-validation.test.ts` to check for new content
2. Add new test cases for new API methods
3. Update flow diagram above
4. Re-run all tests to ensure consistency

### Adding New Test Cases

When adding new SDK features:

1. Document in README
2. Add to docs site
3. Create test in `full-journey.test.ts`
4. Add validation in `docs-validation.test.ts`
5. Update this README

## Troubleshooting

### Tests Pass But Documentation is Wrong

This can happen if:
- Tests use hardcoded values instead of following docs
- Tests make assumptions not documented
- Documentation is ambiguous but tests interpret one way

**Fix**: Review test assertions and compare with documentation step-by-step.

### Documentation is Right But Tests Fail

This can happen if:
- API behavior changed but tests weren't updated
- Environment setup is incomplete
- Network/timing issues

**Fix**: Check API server logs, verify environment variables, increase timeouts.

### Browser Tests Fail Locally But Pass in CI

This can happen if:
- Local server not running
- Different browser versions
- Missing security headers locally

**Fix**: Check `vite.config.ts` has correct headers, ensure local server is running.

## Questions?

If you encounter issues with these tests or the documentation:

1. Check the [documentation](https://underscore.audio/docs)
2. Review this README
3. Open an issue at https://github.com/po-studio/underscore/issues
4. Tag with `e2e-tests` label
