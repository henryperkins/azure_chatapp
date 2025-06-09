import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";


export default defineConfig([
  {                        // ignore bundled third-party code
    ignores: ['static/js/vendor/**']
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    rules: {
      "no-unused-vars": [
        "warn", // or "error" for stricter enforcement
        {
          "vars": "all",
          "args": "after-used",
          "ignoreRestSiblings": false,
          "argsIgnorePattern": "^_", // Ignore arguments starting with underscore
          "varsIgnorePattern": "^_" // Also ignore variables starting with underscore if needed
        }
      ]
    }
  },
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: { globals: globals.browser } },
  {
    files: ["**/*.test.js", "tests/**/*.js", "static/js/__tests__/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jest,
        describe: "readonly",
        test: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        jest: "readonly"
      }
    }
  }
]);
