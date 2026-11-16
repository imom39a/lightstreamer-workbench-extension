// Flat ESLint configuration for the Workbench extension, its Node tooling and tests.
// Type-aware linting is intentionally not enabled: `npm run typecheck` already owns
// type contracts, and the syntactic rule set keeps `npm run lint` fast.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-firefox/**",
      "site-dist/**",
      "release/**",
      "node_modules/**",
      ".cache/**",
      ".scratch/**",
      ".codex/**",
      ".claude/**",
      "test-results/**",
      "private/**",
      "issues/**",
      "agent/dist/**",
      "agent/skills/**",
      "fixtures/lightstreamer/adapter/target/**",
      "fixtures/lightstreamer/adapters/*/lib/**",
      "fixtures/lightstreamer/pages/mutate-reinject-client.js"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      // TypeScript resolves identifiers itself; `no-undef` only produces false
      // positives for DOM, extension and ambient types in TypeScript sources.
      "no-undef": "off"
    }
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    }
  },
  {
    files: ["src/**/*.{ts,tsx}", "fixtures/lightstreamer/client/**", "fixtures/lightstreamer/pages/**", "site/**/*.{js,mjs}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions }
    }
  },
  {
    files: ["tests/**", "benchmarks/**", "*.config.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.vitest }
    }
  },
  {
    // Node scripts that pass callbacks to Playwright/CDP `evaluate`; those
    // callbacks run inside the browser page, not in Node.
    files: [
      "scripts/event-history-100k-activation.mjs",
      "scripts/generate-agent-access-visual-evidence.mjs",
      "scripts/generate-filter-contextual-actions-visual-packet.mjs",
      "scripts/generate-workbench-visual-evidence.mjs",
      "scripts/measure-panel.mjs"
    ],
    languageOptions: {
      globals: { ...globals.browser }
    }
  },
  {
    rules: {
      // Existing debt is reported as warnings so `npm run lint` can gate new
      // errors now; tighten each rule to "error" once its warnings reach zero.
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
      "no-unsafe-finally": "warn",
      "no-unassigned-vars": "warn",
      "no-regex-spaces": "warn",
      "prefer-const": "warn",
      "preserve-caught-error": "warn",
      // Control-character classes are deliberate: diagnostics and instrumentation
      // sanitize or detect C0 characters in captured strings.
      "no-control-regex": "off"
    }
  },
  {
    // typecheck:scripts opts a few harnesses out with a documented file-level
    // `@ts-nocheck`; require the reason instead of banning the directive.
    files: ["scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-nocheck": "allow-with-description" }]
    }
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // Production sources currently have no `any`; keep it that way.
      "@typescript-eslint/no-explicit-any": "error"
    }
  },
  {
    files: ["tests/**", "benchmarks/**"],
    rules: {
      // Test doubles and partial browser/extension fakes legitimately use `any`.
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    // Playwright fixtures must destructure their first argument, even when empty.
    files: ["tests/**/*.spec.ts"],
    rules: { "no-empty-pattern": "off" }
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // Warn first: dependency arrays are reviewed case by case in the panel.
      "react-hooks/exhaustive-deps": "warn"
    }
  }
);
