import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Required for WASM files to be served with correct MIME type
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['@underscore/sdk', 'supersonic-scsynth'],
  },
  build: {
    // Ensure workers are bundled correctly
    rollupOptions: {
      output: {
        // Keep worker files as separate chunks
        manualChunks: undefined,
      },
    },
  },
  // Handle worker files properly
  worker: {
    format: 'es',
  },
});
