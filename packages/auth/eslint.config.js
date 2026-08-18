import { config as baseConfig } from "@12-apps/eslint-config/react-internal";
import testFlakiness from "eslint-plugin-test-flakiness";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    // Registers `eslint-plugin-test-flakiness` with every rule left OFF — the
    // same trick, for the same reason, as packages/prisma and
    // packages/entitlements. The rules are enforced by the repo-root CI lane
    // (eslint.flakiness.config.mjs), not here, but a test that legitimately
    // suppresses one carries an inline directive, and ESLint reports
    // "Definition for rule not found" for a directive naming a plugin it has
    // never heard of. Registered-but-off also makes every such directive read
    // as unused, so that report is scoped off for test files only — the rest of
    // the package keeps directive hygiene.
    files: ["**/__tests__/**", "**/*.test.{ts,tsx}"],
    plugins: { "test-flakiness": testFlakiness },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
];
