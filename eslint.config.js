import tseslint from "typescript-eslint";

/**
 * SDK-specific ESLint configuration with strict TypeScript rules.
 * This ensures high code quality for the public SDK.
 */
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "demo/**", "**/*.test.ts", "test/**"],
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
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["src/bin/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/debug.ts"],
    rules: {
      "no-console": "off",
    },
  }
);
