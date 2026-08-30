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
    files: ["**/__tests__/**", "**/*.test.{ts,tsx}"],
    plugins: { "test-flakiness": testFlakiness },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  /**
   * Nothing here may log to the console: this package runs inside somebody
   * else's app, where a stray line reaches a visitor's devtools and nowhere
   * anyone reads. Faults are RETURNED (see the scan half's `CameraFault`),
   * never printed.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/__tests__/**", "**/*.test.{ts,tsx}"],
    rules: { "no-console": "error" },
  },
];
