// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import tsParser from '@typescript-eslint/parser';
import storybook from "eslint-plugin-storybook";
import testFlakiness from 'eslint-plugin-test-flakiness';
import globals from 'globals';

import { config } from "@12-apps/eslint-config/base";

export default [
  {
    ignores: [
      'packages/ui/scripts/check-component.js',
      'packages/ui/tsup.config.ts',
      'node_modules/**',
      'dist/**',
      'build/**',
      'storybook-static/**',
      'packages/ui/scripts/**',
      'packages/ui/scripts/**/*',
      'scripts/**',
      'scripts/**/*',
      'tsup.config.ts',
    ],
  },
  ...config,
  ...storybook.configs["flat/recommended"],

  // The flakiness gate is a separate lane (eslint.flakiness.config.mjs), so its
  // rules are not enabled here. Test files still carry inline disables for the
  // few findings that are deliberate, and without the plugin registered those
  // directives fail to resolve — "definition for rule ... was not found" — which
  // this everyday lint run counts as a warning under --max-warnings 0.
  // Registering the plugin with no rules turned on makes them resolve.
  {
    plugins: { 'test-flakiness': testFlakiness },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  // Override parser for all TypeScript files after storybook config
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        React: 'readonly',
        google: 'readonly',
        // Node-specific globals needed for build tools
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
      },
    },
    rules: {
      // Use TypeScript's unused vars instead of base rule
      'no-unused-vars': 'off',
    },
  },
  // UI-specific rules
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-console': 'error',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      // Turbo env vars not relevant for UI lib
      'turbo/no-undeclared-env-vars': 'off',
      // Allow underscore-prefixed unused vars (intentionally unused params)
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
    },
  },
];
