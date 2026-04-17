import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Live tests have their own config (vitest.live.config.ts) and a
    // separate `npm run test:live` script. Excluding them here keeps
    // `npm test` hermetic (no real network, no real API key needed).
    exclude: ["node_modules/**", "dist/**", "test/live/**"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/bin/**"],
    },
  },
});
