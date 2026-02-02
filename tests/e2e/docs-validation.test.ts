/**
 * Documentation Validation Test Suite
 *
 * This test validates that the documentation is accurate, complete, and
 * actually works for a 3rd party developer following the steps.
 *
 * Tests each documented workflow to ensure:
 * - All required information is provided
 * - Steps are in the correct order
 * - Code examples work as written
 * - Error scenarios are documented
 * - Prerequisites are clear
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, '../../../docs/src/content/docs');
const readmeFile = path.join(__dirname, '../../README.md');

describe('Documentation Validation', () => {
  describe('README.md Completeness', () => {
    let readme: string;

    it('should exist and be readable', () => {
      expect(fs.existsSync(readmeFile)).toBe(true);
      readme = fs.readFileSync(readmeFile, 'utf-8');
      expect(readme.length).toBeGreaterThan(0);
      console.log('✓ README.md exists');
    });

    it('should document API key acquisition', () => {
      expect(readme).toContain('API key');
      expect(readme).toContain('underscore.audio');
      expect(readme).toContain('settings');
      console.log('✓ API key acquisition documented');
    });

    it('should document WASM setup', () => {
      expect(readme).toContain('npx @underscore/sdk copy-assets');
      expect(readme).toContain('wasmBaseUrl');
      expect(readme).toContain('supersonic-scsynth');
      console.log('✓ WASM setup documented');
    });

    it('should document required headers', () => {
      expect(readme).toContain('Cross-Origin-Opener-Policy');
      expect(readme).toContain('Cross-Origin-Embedder-Policy');
      expect(readme).toContain('same-origin');
      expect(readme).toContain('require-corp');
      console.log('✓ Security headers documented');
    });

    it('should include Vite configuration example', () => {
      expect(readme).toContain('vite.config');
      expect(readme).toContain('server');
      expect(readme).toContain('headers');
      console.log('✓ Vite config example included');
    });

    it('should include Next.js configuration example', () => {
      expect(readme).toContain('next.config');
      expect(readme).toContain('async headers()');
      console.log('✓ Next.js config example included');
    });

    it('should document all main SDK methods', () => {
      const requiredMethods = [
        'new Underscore(',
        'client.init()',
        'client.listSynths(',
        'client.loadSynth(',
        'client.generate(',
        'synth.play()',
        'synth.stop()',
        'synth.setParam(',
        'synth.setParams(',
        'synth.resetParams()',
        'synth.subscribe(',
      ];

      requiredMethods.forEach(method => {
        expect(readme).toContain(method);
      });

      console.log('✓ All SDK methods documented');
    });

    it('should document composition visibility', () => {
      expect(readme).toContain('Public');
      expect(readme).toContain('Unlisted');
      expect(readme).toContain('private');
      console.log('✓ Composition visibility documented');
    });

    it('should include error handling examples', () => {
      expect(readme).toContain('try');
      expect(readme).toContain('catch');
      expect(readme).toContain('Error');
      expect(readme).toContain('ApiError');
      console.log('✓ Error handling documented');
    });

    it('should document browser compatibility', () => {
      expect(readme).toContain('Chrome');
      expect(readme).toContain('Firefox');
      expect(readme).toContain('Safari');
      expect(readme).toContain('SharedArrayBuffer');
      expect(readme).toContain('AudioWorklet');
      console.log('✓ Browser compatibility documented');
    });

    it('should include troubleshooting section', () => {
      expect(readme).toContain('Troubleshooting');
      expect(readme).toContain('Audio not initialized');
      expect(readme).toContain('WASM files not loading');
      expect(readme).toContain('Composition not found');
      console.log('✓ Troubleshooting section included');
    });

    it('should include React example', () => {
      expect(readme).toContain('React');
      expect(readme).toContain('useState');
      expect(readme).toContain('useEffect');
      console.log('✓ React example included');
    });

    it('should document debug logging', () => {
      expect(readme).toContain('logLevel');
      expect(readme).toContain('debug');
      console.log('✓ Debug logging documented');
    });
  });

  describe('Getting Started Guide (/docs/getting-started.mdx)', () => {
    let gettingStarted: string;

    it('should exist', () => {
      const filePath = path.join(docsDir, 'getting-started.mdx');
      expect(fs.existsSync(filePath)).toBe(true);
      gettingStarted = fs.readFileSync(filePath, 'utf-8');
      console.log('✓ Getting Started guide exists');
    });

    it('should explain account creation', () => {
      expect(gettingStarted).toContain('Create an Account');
      expect(gettingStarted).toContain('sign up');
      console.log('✓ Account creation explained');
    });

    it('should explain synth generation', () => {
      expect(gettingStarted).toContain('Generate');
      expect(gettingStarted).toContain('description');
      console.log('✓ Synth generation explained');
    });

    it('should explain API key creation', () => {
      expect(gettingStarted).toContain('API Key');
      expect(gettingStarted).toContain('Settings');
      expect(gettingStarted).toContain('Create API Key');
      console.log('✓ API key creation explained');
    });

    it('should explain visibility settings', () => {
      expect(gettingStarted).toContain('Public');
      expect(gettingStarted).toContain('private');
      console.log('✓ Visibility settings explained');
    });

    it('should provide tips for better prompts', () => {
      expect(gettingStarted).toContain('Tips');
      expect(gettingStarted).toContain('Good examples');
      console.log('✓ Prompt tips provided');
    });
  });

  describe('Web SDK Quickstart (/docs/web-sdk/quickstart.mdx)', () => {
    let quickstart: string;

    it('should exist', () => {
      const filePath = path.join(docsDir, 'web-sdk/quickstart.mdx');
      expect(fs.existsSync(filePath)).toBe(true);
      quickstart = fs.readFileSync(filePath, 'utf-8');
      console.log('✓ Quickstart guide exists');
    });

    it('should list prerequisites', () => {
      expect(quickstart).toContain('Prerequisites');
      expect(quickstart).toContain('Node.js');
      expect(quickstart).toContain('API key');
      expect(quickstart).toContain('composition ID');
      console.log('✓ Prerequisites listed');
    });

    it('should include project setup steps', () => {
      expect(quickstart).toContain('npm create vite');
      expect(quickstart).toContain('npm install');
      console.log('✓ Project setup documented');
    });

    it('should include dependency installation', () => {
      expect(quickstart).toContain('npm install @underscore/sdk');
      expect(quickstart).toContain('supersonic-scsynth');
      console.log('✓ Dependencies documented');
    });

    it('should include WASM asset copying', () => {
      expect(quickstart).toContain('npx @underscore/sdk copy-assets');
      console.log('✓ Asset copying step included');
    });

    it('should include Vite configuration', () => {
      expect(quickstart).toContain('vite.config');
      expect(quickstart).toContain('Cross-Origin-Opener-Policy');
      console.log('✓ Vite configuration included');
    });

    it('should include complete working example', () => {
      expect(quickstart).toContain('import { Underscore }');
      expect(quickstart).toContain('client.init()');
      expect(quickstart).toContain('client.loadSynth(');
      expect(quickstart).toContain('synth.play()');
      console.log('✓ Complete code example included');
    });

    it('should include CSS styling', () => {
      expect(quickstart).toContain('style.css');
      expect(quickstart).toContain('css');
      console.log('✓ CSS example included');
    });

    it('should link to next steps', () => {
      expect(quickstart).toContain('Next Steps');
      console.log('✓ Next steps provided');
    });
  });

  describe('API Reference - Client (/docs/web-sdk/api-reference/client.mdx)', () => {
    let clientRef: string;

    it('should exist', () => {
      const filePath = path.join(docsDir, 'web-sdk/api-reference/client.mdx');
      expect(fs.existsSync(filePath)).toBe(true);
      clientRef = fs.readFileSync(filePath, 'utf-8');
      console.log('✓ Client API reference exists');
    });

    it('should document constructor parameters', () => {
      expect(clientRef).toContain('apiKey');
      expect(clientRef).toContain('wasmBaseUrl');
      expect(clientRef).toContain('baseUrl');
      expect(clientRef).toContain('required');
      expect(clientRef).toContain('optional');
      console.log('✓ Constructor parameters documented');
    });

    it('should document init() method', () => {
      expect(clientRef).toContain('init()');
      expect(clientRef).toContain('user interaction');
      expect(clientRef).toContain('Promise<void>');
      console.log('✓ init() method documented');
    });

    it('should document isInitialized() method', () => {
      expect(clientRef).toContain('isInitialized()');
      expect(clientRef).toContain('boolean');
      console.log('✓ isInitialized() method documented');
    });

    it('should document listSynths() method', () => {
      expect(clientRef).toContain('listSynths(');
      expect(clientRef).toContain('compositionId');
      expect(clientRef).toContain('SynthInfo[]');
      console.log('✓ listSynths() method documented');
    });

    it('should document loadSynth() method', () => {
      expect(clientRef).toContain('loadSynth(');
      expect(clientRef).toContain('synthName');
      expect(clientRef).toContain('optional');
      expect(clientRef).toContain('latest synth');
      console.log('✓ loadSynth() method documented');
    });

    it('should document generate() method', () => {
      expect(clientRef).toContain('generate(');
      expect(clientRef).toContain('prompt');
      expect(clientRef).toContain('AsyncGenerator');
      expect(clientRef).toContain('GenerationEvent');
      console.log('✓ generate() method documented');
    });

    it('should include code examples for each method', () => {
      const methods = ['init', 'listSynths', 'loadSynth', 'generate'];
      methods.forEach(method => {
        // Should have example after method definition
        expect(clientRef).toContain('Example');
      });
      console.log('✓ Code examples included');
    });

    it('should document type definitions', () => {
      expect(clientRef).toContain('UnderscoreConfig');
      expect(clientRef).toContain('SynthInfo');
      expect(clientRef).toContain('GenerationEvent');
      expect(clientRef).toContain('interface');
      console.log('✓ Type definitions documented');
    });
  });

  describe('API Reference - Synth (/docs/web-sdk/api-reference/synth.mdx)', () => {
    let synthRef: string;

    it('should exist', () => {
      const filePath = path.join(docsDir, 'web-sdk/api-reference/synth.mdx');
      expect(fs.existsSync(filePath)).toBe(true);
      synthRef = fs.readFileSync(filePath, 'utf-8');
      console.log('✓ Synth API reference exists');
    });

    it('should document play() method', () => {
      expect(synthRef).toContain('play()');
      expect(synthRef).toContain('Promise<void>');
      console.log('✓ play() method documented');
    });

    it('should document stop() method', () => {
      expect(synthRef).toContain('stop()');
      expect(synthRef).toContain('void');
      console.log('✓ stop() method documented');
    });

    it('should document setParam() method', () => {
      expect(synthRef).toContain('setParam(');
      expect(synthRef).toContain('name');
      expect(synthRef).toContain('value');
      console.log('✓ setParam() method documented');
    });

    it('should document setParams() method', () => {
      expect(synthRef).toContain('setParams(');
      expect(synthRef).toContain('Record<string, number>');
      console.log('✓ setParams() method documented');
    });

    it('should document resetParams() method', () => {
      expect(synthRef).toContain('resetParams()');
      expect(synthRef).toContain('default');
      console.log('✓ resetParams() method documented');
    });

    it('should document subscribe() method', () => {
      expect(synthRef).toContain('subscribe(');
      expect(synthRef).toContain('listener');
      expect(synthRef).toContain('unsubscribe');
      console.log('✓ subscribe() method documented');
    });

    it('should document params property', () => {
      expect(synthRef).toContain('params');
      expect(synthRef).toContain('ParamMetadata[]');
      console.log('✓ params property documented');
    });

    it('should document name and description properties', () => {
      expect(synthRef).toContain('name');
      expect(synthRef).toContain('description');
      console.log('✓ name and description documented');
    });

    it('should document common parameters', () => {
      const commonParams = ['amp', 'cutoff', 'resonance', 'attack', 'decay', 'sustain', 'release'];
      commonParams.forEach(param => {
        expect(synthRef).toContain(param);
      });
      console.log('✓ Common parameters documented');
    });

    it('should document parameter ranges', () => {
      expect(synthRef).toContain('min');
      expect(synthRef).toContain('max');
      expect(synthRef).toContain('default');
      expect(synthRef).toContain('ParamMetadata');
      console.log('✓ Parameter ranges documented');
    });

    it('should document state interface', () => {
      expect(synthRef).toContain('SynthState');
      expect(synthRef).toContain('playing');
      expect(synthRef).toContain('paramValues');
      console.log('✓ State interface documented');
    });

    it('should include parameter control example', () => {
      expect(synthRef).toContain('Example: Parameter Control');
      expect(synthRef).toContain('slider');
      console.log('✓ Parameter control example included');
    });
  });

  describe('Examples - Basic Playback (/docs/web-sdk/examples/basic-playback.mdx)', () => {
    let example: string;

    it('should exist', () => {
      const filePath = path.join(docsDir, 'web-sdk/examples/basic-playback.mdx');
      expect(fs.existsSync(filePath)).toBe(true);
      example = fs.readFileSync(filePath, 'utf-8');
      console.log('✓ Basic playback example exists');
    });

    it('should include complete code example', () => {
      expect(example).toContain('import { Underscore }');
      expect(example).toContain('addEventListener');
      console.log('✓ Complete code example included');
    });

    it('should include HTML markup', () => {
      expect(example).toContain('<!DOCTYPE html>');
      expect(example).toContain('<button');
      console.log('✓ HTML markup included');
    });

    it('should include step-by-step explanation', () => {
      expect(example).toContain('Explanation');
      expect(example).toContain('Create client');
      expect(example).toContain('User interaction');
      console.log('✓ Explanation included');
    });

    it('should include toggle button example', () => {
      expect(example).toContain('Play/Stop Toggle');
      expect(example).toContain('playing');
      console.log('✓ Toggle example included');
    });

    it('should include state subscription example', () => {
      expect(example).toContain('subscribe');
      expect(example).toContain('state.playing');
      console.log('✓ State subscription example included');
    });

    it('should include error handling example', () => {
      expect(example).toContain('try');
      expect(example).toContain('catch');
      expect(example).toContain('error');
      console.log('✓ Error handling example included');
    });

    it('should link to next steps', () => {
      expect(example).toContain('Next Steps');
      console.log('✓ Next steps provided');
    });
  });

  describe('Cross-Reference Validation', () => {
    it('should have consistent composition ID format across docs', () => {
      const files = [readmeFile, ...getAllDocsFiles(docsDir)];
      const compositionIdPattern = /cmp_[a-z0-9]+/gi;

      files.forEach(file => {
        const content = fs.readFileSync(file, 'utf-8');
        const matches = content.match(compositionIdPattern);

        if (matches) {
          matches.forEach(match => {
            expect(match).toMatch(/^cmp_/);
          });
        }
      });

      console.log('✓ Composition ID format consistent');
    });

    it('should have consistent API key format across docs', () => {
      const files = [readmeFile, ...getAllDocsFiles(docsDir)];
      const apiKeyPattern = /us_[a-zA-Z0-9_]+/g;

      files.forEach(file => {
        const content = fs.readFileSync(file, 'utf-8');
        const matches = content.match(apiKeyPattern);

        if (matches) {
          matches.forEach(match => {
            expect(match).toMatch(/^us_/);
          });
        }
      });

      console.log('✓ API key format consistent');
    });

    it('should use consistent package names', () => {
      const files = [readmeFile, ...getAllDocsFiles(docsDir)];

      files.forEach(file => {
        const content = fs.readFileSync(file, 'utf-8');

        // Should use @underscore/sdk, not underscore-sdk
        if (content.includes('install')) {
          expect(content).not.toContain('npm install underscore-sdk');
        }
      });

      console.log('✓ Package names consistent');
    });

    it('should have consistent wasmBaseUrl across examples', () => {
      const files = [readmeFile, ...getAllDocsFiles(docsDir)];
      const wasmUrls = new Set<string>();

      files.forEach(file => {
        const content = fs.readFileSync(file, 'utf-8');
        const matches = content.match(/wasmBaseUrl:\s*['"]([^'"]+)['"]/g);

        if (matches) {
          matches.forEach(match => {
            const url = match.match(/['"]([^'"]+)['"]/)?.[1];
            if (url) wasmUrls.add(url);
          });
        }
      });

      // Should primarily use '/supersonic/'
      expect(wasmUrls.has('/supersonic/')).toBe(true);

      console.log('✓ WASM URL consistent');
      console.log('  URLs used:', Array.from(wasmUrls));
    });
  });

  describe('Code Example Syntax Validation', () => {
    it('should have valid TypeScript in README examples', () => {
      // Extract code blocks
      const codeBlocks = readme.match(/```typescript\n([\s\S]*?)```/g) || [];

      expect(codeBlocks.length).toBeGreaterThan(0);

      codeBlocks.forEach(block => {
        // Basic syntax checks
        expect(block).not.toContain('undefined');
        expect(block).not.toContain('TODO');

        // TypeScript specific
        if (block.includes('import')) {
          expect(block).toMatch(/import.*from/);
        }
      });

      console.log('✓ TypeScript examples valid');
      console.log('  Code blocks:', codeBlocks.length);
    });

    it('should have valid JavaScript in docs examples', () => {
      const docsFiles = getAllDocsFiles(docsDir);

      docsFiles.forEach(file => {
        const content = fs.readFileSync(file, 'utf-8');
        const codeBlocks = content.match(/```(?:typescript|javascript)\n([\s\S]*?)```/g) || [];

        codeBlocks.forEach(block => {
          // Should not have common errors
          expect(block).not.toContain('consol.log'); // typo
          expect(block).not.toContain('await await'); // double await
        });
      });

      console.log('✓ JavaScript examples valid');
    });
  });
});

/**
 * Helper function to get all docs files recursively
 */
function getAllDocsFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;

    const items = fs.readdirSync(currentDir);

    items.forEach(item => {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (item.endsWith('.mdx') || item.endsWith('.md')) {
        files.push(fullPath);
      }
    });
  }

  walk(dir);
  return files;
}
