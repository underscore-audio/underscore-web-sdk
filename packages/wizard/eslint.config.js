import tseslint from "typescript-eslint";

/**
 * Wizard-specific ESLint config.
 *
 * The wizard is a CLI and uses console output heavily for UX, so the
 * no-console rule is relaxed relative to the SDK. Otherwise it mirrors
 * the SDK's strictness so the two packages feel consistent.
 */
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "templates/**", "**/*.test.ts", "test/**"],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-console": "off",
    },
  }
);
