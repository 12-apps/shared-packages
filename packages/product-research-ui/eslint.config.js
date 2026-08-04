import { config as baseConfig } from '@12-apps/eslint-config/base';
import testFlakiness from 'eslint-plugin-test-flakiness';

/**
 * The test-flakiness plugin is registered with all rules off purely so inline
 * `// eslint-disable-next-line test-flakiness/...` directives resolve; the
 * rules themselves are enforced by the root CI flakiness lane.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...baseConfig,
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    plugins: { 'test-flakiness': testFlakiness },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  // The library-first boundary (FUT-414), enforced: these screens are
  // host-agnostic — components take a ResearchApiClient the host implements
  // and never import app code or host infrastructure. A feature that needs
  // host behavior extends the client seam (or a port in
  // @12-apps/product-research/src/ports.ts), never imports the app.
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
                'The product-research-ui package must not import from apps/*. Host behavior enters through the ResearchApiClient seam.',
            },
            {
              group: [
                '@12-apps/shared-helpers',
                '@12-apps/shared-helpers/**',
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
                'Host-only module. Research screens stay host-agnostic — data and behavior arrive through the ResearchApiClient the host implements.',
            },
          ],
        },
      ],
    },
  },
];
