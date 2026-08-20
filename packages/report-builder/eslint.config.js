import { config as baseConfig } from '@12-apps/eslint-config/base';
import testFlakiness from 'eslint-plugin-test-flakiness';
import { observabilityConfig } from '@12-apps/eslint-config/observability';

/**
 * The test-flakiness plugin is registered with all rules off purely so inline
 * `// eslint-disable-next-line test-flakiness/...` directives resolve; the
 * rules themselves are enforced by the root CI flakiness lane.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...observabilityConfig,
  ...baseConfig,
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    plugins: { 'test-flakiness': testFlakiness },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
];
