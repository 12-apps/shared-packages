import { config as baseConfig } from '@12-apps/eslint-config/base';
import storybook from 'eslint-plugin-storybook';
import testFlakiness from 'eslint-plugin-test-flakiness';

/**
 * The everyday DX lint for this package.
 *
 * It registers `eslint-plugin-test-flakiness` with every rule left OFF. Those
 * rules are enforced by the repo-root CI lane (`eslint.flakiness.config.mjs`),
 * not here — but a test file that legitimately suppresses one carries an inline
 * `// eslint-disable-next-line test-flakiness/...` directive, and ESLint reports
 * "Definition for rule not found" for a directive naming a plugin it has never
 * heard of. Registering the plugin lets those directives RESOLVE without this
 * config enforcing anything.
 *
 * Same trick, same reason as the root `eslint.complexity.config.mjs`, which
 * registers `@typescript-eslint` (rules off) so source-file directives resolve
 * inside that isolated gate.
 */

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  // Storybook's own rules (FUT-742), same as packages/ui: they catch the story
  // mistakes a type-check cannot — a default export that is not a `Meta`, a
  // story exported without a name, a `render` that is not a component.
  ...storybook.configs['flat/recommended'],
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    plugins: { 'test-flakiness': testFlakiness },
    // Registered-but-off means the rule never fires here, which would make
    // every legitimate directive read as "unused". Scoped to test files so the
    // rest of the package still gets dead-directive hygiene.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'storybook-static/**'],
  },
];
