import { config as baseConfig } from '@12-apps/eslint-config/base';
import testFlakiness from 'eslint-plugin-test-flakiness';

/**
 * The test-flakiness plugin is registered with all rules off purely so the
 * file-level `eslint-disable test-flakiness/...` directives in the portability
 * and packed-artifact suites resolve; the rules themselves are enforced by the
 * root CI flakiness lane (`pnpm quality:flakiness`), which is where they belong.
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
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
];
