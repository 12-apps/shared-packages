import { config as baseConfig } from "@12-apps/eslint-config/base";
import testFlakiness from "eslint-plugin-test-flakiness";

/**
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
  /**
   * A background agent has no console anybody reads — it is started by the
   * operating system at login, with no terminal attached. Faults are REPORTED
   * through the shell's own status and the host's log port, never printed.
   */
  {
    files: ["src/**/*.ts"],
    ignores: ["**/__tests__/**", "**/*.test.ts"],
    rules: { "no-console": "error" },
  },
];
