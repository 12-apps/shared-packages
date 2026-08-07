import { config as baseConfig } from "@12-apps/eslint-config/base";
import testFlakiness from "eslint-plugin-test-flakiness";

/**
 * The test-flakiness plugin is registered with all rules off purely so inline
 * `// eslint-disable-next-line test-flakiness/...` directives resolve; the
 * rules themselves are enforced by the repo-root flakiness lane.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...baseConfig,
  {
    files: ["**/__tests__/**", "**/*.test.ts"],
    plugins: { "test-flakiness": testFlakiness },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
];
