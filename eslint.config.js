// ESLint covers the browser modules in public/js, which have no type checker.
// The TypeScript in src/ and test/ is checked by `tsc` with strict + unused/return flags instead:
// TypeScript 7 no longer ships the JS compiler API that typescript-eslint relies on.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "dist/", "data/"] },
  {
    files: ["public/**/*.js"],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: globals.browser },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      "no-implicit-globals": "error",
    },
  },
  {
    files: ["eslint.config.js"],
    languageOptions: { sourceType: "module", globals: globals.node },
  },
];
