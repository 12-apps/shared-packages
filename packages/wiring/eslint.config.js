import { config as baseConfig } from "@12-apps/eslint-config/base";
import testFlakiness from "eslint-plugin-test-flakiness";
import { observabilityConfig } from "@12-apps/eslint-config/observability";

/**
 * The everyday DX lint for this package. Mirrors `packages/jobs`:
 * `eslint-plugin-test-flakiness` is registered with every rule OFF so that
 * inline disable directives in test files RESOLVE here, while the rules
 * themselves stay enforced by the repo-root flakiness lane.
 */

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...observabilityConfig,
  ...baseConfig,
  {
    files: ["**/__tests__/**", "**/*.test.ts"],
    plugins: { "test-flakiness": testFlakiness },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
];
