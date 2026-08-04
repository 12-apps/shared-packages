import { config as baseConfig } from '@12-apps/eslint-config/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
];
