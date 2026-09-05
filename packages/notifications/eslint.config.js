import { config as baseConfig } from '@12-apps/eslint-config/base';
import { config as reactConfig } from '@12-apps/eslint-config/react-internal';
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
  /*
   * EVERY `.tsx` in the package, not just `src/react/`: five more React
   * components live under `src/email/previews/react/`, and scoping the preset
   * to one directory left `react/jsx-no-comment-textnodes` absent on exactly
   * the files a rendered-comment defect would ship from just as visibly.
   *
   * A config object whose ONLY key is `ignores` is a GLOBAL ignore; giving it a
   * `files` key demotes it to an ordinary block and silently drops the ignore,
   * so those pass through untouched.
   */
  ...reactConfig.map((c) =>
    Object.keys(c).length === 1 && c.ignores ? c : { ...c, files: ['src/**/*.tsx'] },
  ),
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    plugins: { 'test-flakiness': testFlakiness },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
];
