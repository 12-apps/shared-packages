import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import testFlakiness from "eslint-plugin-test-flakiness";
import {
  E2E_GLOBS,
  FLAKY_ALL,
  FLAKY_ALL_OFF,
  FLAKY_E2E,
  FLAKY_INTEGRATION_OFF,
  GLOBAL_IGNORES,
  INTEGRATION_GLOBS,
  TEST_GLOBS,
  loadExceptions,
} from "./eslint.quality.shared.mjs";

/**
 * FLAKINESS half of the split static-quality gate — run via
 * `pnpm quality:flakiness`. Lints TEST / spec / story files for anti-flake
 * patterns (eslint-plugin-test-flakiness), tiered the way tabwoah tiers them:
 * unit tests get the full set, integration/stress relax the DB/network/fs/state
 * rules they legitimately use, and e2e specs keep only the timing/query
 * heuristics.
 *
 * This half is CI-only (see 12-apps/ci quality.yml). The cheap source-only
 * complexity half lives in eslint.complexity.config.mjs and also runs on
 * pre-commit. Shared thresholds/ignores/grandfather live in
 * eslint.quality.shared.mjs.
 */

export default [
  { ignores: GLOBAL_IGNORES },

  // This gate runs in ISOLATION from the everyday `pnpm lint`, so files carry
  // inline `// eslint-disable` comments for rules this config does not enable.
  // Register the TS plugin (rules stay off) so those directives resolve instead
  // of erroring "definition not found", and stop reporting the now-unused
  // directives as problems.
  {
    plugins: { "@typescript-eslint": tsPlugin },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },

  // ---- Test-flakiness gate (tiered) ---------------------------------------
  {
    files: TEST_GLOBS,
    languageOptions: { parser: tsParser },
    plugins: { "test-flakiness": testFlakiness },
    rules: FLAKY_ALL,
  },
  {
    files: E2E_GLOBS,
    rules: { ...FLAKY_ALL_OFF, ...FLAKY_E2E },
  },
  {
    files: INTEGRATION_GLOBS,
    rules: FLAKY_INTEGRATION_OFF,
  },

  // ---- Ratchet: grandfather pre-existing offenders ------------------------
  // Files listed in `.quality-exceptions` pre-date the gate; their flakiness
  // findings drop to WARNINGS (visible, non-blocking). Any file NOT listed
  // stays a hard error. This block is LAST so its severities win.
  ...flakinessGrandfatherBlock(),
];

function flakinessGrandfatherBlock() {
  const files = loadExceptions();
  if (files.length === 0) return [];
  return [
    {
      files,
      // The exceptions list also carries SOURCE files (it is shared with the
      // complexity gate). In the old combined config those inherited tsParser
      // from the size/complexity block; here there is no such block, so set the
      // parser explicitly or the source entries hit espree and fail to parse.
      languageOptions: { parser: tsParser },
      plugins: { "test-flakiness": testFlakiness },
      rules: Object.fromEntries(Object.keys(FLAKY_ALL).map((k) => [k, "warn"])),
    },
  ];
}
