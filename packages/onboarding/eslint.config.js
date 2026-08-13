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
   * Nothing that runs in a browser may log to the console.
   *
   * `console.*` does not pass through this package's reporter, so a line
   * written that way reaches a visitor's devtools and nowhere else — which in
   * practice means nobody reads it. Use `reportWarning` / `reportRouteCrash`.
   *
   * `error` rather than `warn` on purpose: a warning here is a line that
   * silently does not report, and the silence IS the bug. Where the console
   * genuinely is the right answer — the build-time plugin, and the boundary's
   * second copy for a support call — the call site says so with an inline
   * disable and a reason.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/__tests__/**", "**/*.test.{ts,tsx}"],
    rules: { "no-console": "error" },
  },
];
