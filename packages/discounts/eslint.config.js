import { config as baseConfig } from '@12-apps/eslint-config/base';
import storybook from 'eslint-plugin-storybook';
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
  // Storybook's own rules, same as packages/ui and entity-lifecycle: they catch
  // the story mistakes a type-check cannot — a default export that is not a
  // `Meta`, a story exported without a name, a `render` that is not a component.
  ...storybook.configs['flat/recommended'],
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    plugins: { 'test-flakiness': testFlakiness },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'storybook-static/**'] },
];
