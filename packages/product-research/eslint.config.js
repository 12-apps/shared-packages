import { config as baseConfig } from '@12-apps/eslint-config/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  // The library-first boundary (FUT-414), enforced: this package is a
  // framework-free engine that never imports host code. Host behavior enters
  // only through the ports in `src/ports.ts`, bound by the host at mount time
  // (apps/web/lib/research/host.ts) — so a feature that needs the host must
  // extend a port, not import the app.
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['apps/**', '**/apps/**'],
              message:
                'The product-research package must not import from apps/*. Host behavior enters through the ports in src/ports.ts.',
            },
            {
              group: [
                '@12-apps/shared-helpers',
                '@12-apps/shared-helpers/**',
                '@12-apps/prisma',
                '@12-apps/prisma/**',
                '@12-apps/auth',
                '@12-apps/auth/**',
                '@12-apps/jobs',
                '@12-apps/jobs/**',
                '@12-apps/entity-lifecycle',
                '@12-apps/entity-lifecycle/**',
                '@prisma/client',
                '@prisma/client/**',
                'next',
                'next/**',
              ],
              message:
                'Host-only module. The engine receives db/cache/budget/catalog through the ports in src/ports.ts — extend a port instead of importing host infrastructure.',
            },
          ],
        },
      ],
    },
  },
];
