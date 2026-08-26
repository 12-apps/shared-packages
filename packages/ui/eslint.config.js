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
  // No barrel imports of MUI (FUT-910).
  //
  // `import { Box } from '@mui/material'` is a module-graph edge to ALL of MUI,
  // so every consumer of this package inherits whatever else lives in the
  // barrel's chunk and is left relying on tree-shaking to undo it. That reliance
  // was measured failing: the storefront's critical path carried 60 component
  // modules, Dialog/Select/SwipeableDrawer/Tooltip/Popper among them, none of
  // which the first screen renders.
  //
  // This is `paths`, not `patterns`, on purpose — it restricts the EXACT barrel
  // specifiers and leaves `@mui/material/Box`, `@mui/material/styles` and every
  // other per-module path untouched, which is the shape we want people writing.
  //
  // It is scoped to this package because this package is the one allowed to
  // import MUI at all: the `next` config sends every other consumer to
  // `@12-apps/ui/mui/*`. Those re-export files are the reason this rule exists —
  // all seventeen used to be barrel re-exports, so the entry point that was
  // supposed to make a single component cheap delivered the whole library.
  //
  // Type-only imports are restricted too. They cost no bytes, but exempting
  // them means the barrel keeps a foothold in the source and the next edit that
  // needs a value has an import to append to rather than a rule to satisfy.
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@mui/material',
              message:
                "Import the module, not the barrel: `import Box from '@mui/material/Box'`. Theme and style helpers (styled, alpha, keyframes, useTheme, SxProps, Theme, CSSObject) live in '@mui/material/styles'.",
            },
            {
              name: '@mui/icons-material',
              message:
                "Import the icon's own module: `import Check from '@mui/icons-material/Check'`.",
            },
            {
              name: '@mui/lab',
              message: "Import the module, not the barrel: `import Timeline from '@mui/lab/Timeline'`.",
            },
          ],
        },
      ],
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
