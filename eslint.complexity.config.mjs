import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import sonarjs from "eslint-plugin-sonarjs";
import {
  GLOBAL_IGNORES,
  NESTED_LOOP_RULE,
  TEST_GLOBS,
  loadExceptions,
  sizeComplexityAt,
} from "./eslint.quality.shared.mjs";

// Test/spec/story files belong to the flakiness config, not this one. Ignore
// them GLOBALLY here (not just per-block): with no flakiness block in this
// config there is no `languageOptions.parser`, so any test file that slipped
// through would be parsed by the default espree parser and choke on TS syntax.
const COMPLEXITY_IGNORES = [...GLOBAL_IGNORES, ...TEST_GLOBS];

/**
 * COMPLEXITY half of the split static-quality gate — run via
 * `pnpm quality:complexity`. Holds first-party SOURCE (not tests) to the
 * cyclomatic/cognitive/size/nested-loop bar.
 *
 * This half is cheap and source-only, so it also runs on PRE-COMMIT
 * (.githooks/pre-commit) against the staged source files. The flakiness half
 * lives in eslint.flakiness.config.mjs and stays a CI-only lane.
 *
 * See eslint.quality.shared.mjs for the thresholds, ignores, and the
 * `.quality-exceptions` grandfather ratchet shared with the flakiness config.
 */

export default [
  { ignores: COMPLEXITY_IGNORES },

  // This gate runs in ISOLATION from the everyday `pnpm lint`, so source files
  // carry inline `// eslint-disable` comments for rules this config does not
  // enable. Register the TS plugin (rules stay off) so those directives resolve
  // instead of erroring "definition not found", and stop reporting the now-unused
  // directives as problems. This keeps the gate to its own rules only.
  {
    plugins: { "@typescript-eslint": tsPlugin },
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },

  // ---- Size & complexity gate (first-party source only) -------------------
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    ignores: TEST_GLOBS,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { sonarjs },
    rules: {
      ...sizeComplexityAt("error"),
      "no-restricted-syntax": ["error", NESTED_LOOP_RULE],
    },
  },

  // ---- Ratchet: grandfather pre-existing offenders ------------------------
  // Files listed in `.quality-exceptions` pre-date the gate; their complexity
  // findings drop to WARNINGS (visible, non-blocking). Any file NOT listed
  // stays a hard error. This block is LAST so its severities win.
  ...complexityGrandfatherBlock(),
];

function complexityGrandfatherBlock() {
  const files = loadExceptions();
  if (files.length === 0) return [];
  return [
    {
      files,
      plugins: { sonarjs },
      rules: {
        ...sizeComplexityAt("warn"),
        "no-restricted-syntax": ["warn", NESTED_LOOP_RULE],
      },
    },
  ];
}
