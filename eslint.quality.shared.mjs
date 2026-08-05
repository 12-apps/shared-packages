import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared building blocks for the static code-quality gate, consumed by the two
 * split configs:
 *   - eslint.complexity.config.mjs  → size/complexity on first-party source
 *   - eslint.flakiness.config.mjs   → test-flakiness on tests/specs/stories
 *
 * WHY TWO CONFIGS: the gate used to be one `pnpm quality` run. It is split so
 * the cheap, source-only COMPLEXITY gate can run on pre-commit (fast, no test
 * files) while the FLAKINESS gate stays a CI-only lane. Keeping the ignores,
 * globs, thresholds, and the grandfather (`.quality-exceptions`) ratchet here
 * means both configs stay in lockstep — one list to burn down, one source of
 * truth for what counts as a test file.
 *
 * WHY NOT the shared @repo/eslint-config: it loads eslint-plugin-only-warn,
 * which downgrades every rule to a warning. Fine for the DX lint, but a GATE
 * needs hard errors that fail CI. These configs deliberately omit only-warn.
 */

const LOOP =
  "ForStatement, ForInStatement, ForOfStatement, WhileStatement, DoWhileStatement";

// The nested-loop (suspected-O(n^2)) rule, shared by the source gate and the
// grandfather block so both use identical options.
//
// NOTE on Big-O: there is no tool that statically infers true asymptotic
// complexity for JS/TS (it is undecidable in general). The nested-loop rule is
// a deliberate PROXY — it flags a loop inside a loop as a SUSPECTED quadratic
// hot path for human review, not proof of O(n^2).
export const NESTED_LOOP_RULE = {
  selector: `:matches(${LOOP}) :matches(${LOOP})`,
  message:
    "Nested loop (a loop inside another loop) — suspected quadratic O(n^2) or worse hot path. Refactor to avoid the inner loop (e.g. index with a Map/Set), or if it is intentional and provably bounded add `// eslint-disable-next-line no-restricted-syntax -- <reason>`.",
};

// The size/complexity rules, factored out so the grandfather block can reuse
// the exact same thresholds at "warn" severity.
//   - complexity (cyclomatic)      max 10
//   - max-depth                    max 4
//   - max-lines (per file)         max 400
//   - max-lines-per-function       max 80
//   - sonarjs/cognitive-complexity max 15
const SIZE_COMPLEXITY_RULES = {
  complexity: { max: 10 },
  "max-depth": { max: 4 },
  "max-lines": { max: 400, skipBlankLines: false, skipComments: false },
  "max-lines-per-function": {
    max: 80,
    skipBlankLines: false,
    skipComments: false,
    IIFEs: true,
  },
  "sonarjs/cognitive-complexity": 15,
};

export const sizeComplexityAt = (severity) =>
  Object.fromEntries(
    Object.entries(SIZE_COMPLEXITY_RULES).map(([rule, opts]) => [
      rule,
      [severity, opts],
    ]),
  );

// Everything that is not first-party source we want to hold to the size/
// complexity bar, or is machine-generated.
export const GLOBAL_IGNORES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/out/**",
  "**/.turbo/**",
  "**/coverage/**",
  "**/storybook-static/**",
  "**/playwright-report/**",
  "**/test-results/**",
  "**/playwright-coverage/**",
  "**/.e2e-db/**",
  "**/*.d.ts",
  // Prisma client + generated SQL/migration helpers.
  "**/generated/**",
  "**/prisma/generated/**",
];

// Test-ish globs — excluded from size/complexity, linted for flakiness instead.
export const TEST_GLOBS = [
  "**/*.test.{ts,tsx,js,jsx}",
  "**/*.spec.{ts,tsx,js,jsx}",
  "**/tests/**/*.{ts,tsx,js,jsx}",
  "**/__tests__/**/*.{ts,tsx,js,jsx}",
  "**/*.stories.{ts,tsx,js,jsx}",
];

export const INTEGRATION_GLOBS = [
  "**/*.integration.test.{ts,tsx}",
  "**/*.stress.test.{ts,tsx}",
  // Leading `**/` so this matches a package's own suite
  // (packages/shift/tests/integration/**), not just a repo-root one. These run
  // against a real PGlite database, so the DB/network/fs/state flakiness rules
  // are relaxed for the tests AND their helpers and fixtures.
  "**/tests/integration/**/*.{ts,tsx}",
];

// Everything under tests/e2e/ is e2e infrastructure — specs AND their support
// files (helpers, fixtures, reporters, global-setup) — which legitimately drive
// a real browser/server and make real network/fs calls. Match all of it (not
// only *.spec.*) so extracted e2e helpers get the relaxed e2e tier instead of
// being mis-tiered as unit tests (which would flag their real HTTP calls as
// no-unmocked-network errors).
export const E2E_GLOBS = ["**/tests/e2e/**/*.{ts,tsx}"];

// Full anti-flake rule set (unit tests).
export const FLAKY_ALL = {
  "test-flakiness/await-async-events": "error",
  "test-flakiness/no-animation-wait": "error",
  "test-flakiness/no-database-operations": "error",
  "test-flakiness/no-element-removal-check": "error",
  "test-flakiness/no-focus-check": "error",
  "test-flakiness/no-global-state-mutation": "error",
  "test-flakiness/no-hard-coded-timeout": "error",
  "test-flakiness/no-immediate-assertions": "error",
  "test-flakiness/no-index-queries": "error",
  "test-flakiness/no-long-text-match": "error",
  "test-flakiness/no-promise-race": "error",
  "test-flakiness/no-random-data": "error",
  "test-flakiness/no-test-focus": "error",
  "test-flakiness/no-test-isolation": "error",
  "test-flakiness/no-unconditional-wait": "error",
  "test-flakiness/no-unmocked-fs": "error",
  "test-flakiness/no-unmocked-network": "error",
  "test-flakiness/no-viewport-dependent": "error",
};

// Integration/stress tests legitimately touch real DB/network/fs and manage
// their own state — relax those rules (matches tabwoah's oxlint tiers).
export const FLAKY_INTEGRATION_OFF = {
  "test-flakiness/no-database-operations": "off",
  "test-flakiness/no-unmocked-network": "off",
  "test-flakiness/no-unmocked-fs": "off",
  "test-flakiness/no-random-data": "off",
  "test-flakiness/no-test-isolation": "off",
  "test-flakiness/no-global-state-mutation": "off",
};

// Turn every anti-flake rule off, so a later spread can enable just a subset.
export const FLAKY_ALL_OFF = Object.fromEntries(
  Object.keys(FLAKY_ALL).map((k) => [k, "off"]),
);

// E2E specs drive a real browser against a real server — only the timing/query
// heuristics apply; the isolation/mock rules do not.
export const FLAKY_E2E = {
  "test-flakiness/await-async-events": "error",
  "test-flakiness/no-animation-wait": "error",
  "test-flakiness/no-element-removal-check": "error",
  "test-flakiness/no-hard-coded-timeout": "error",
  "test-flakiness/no-immediate-assertions": "error",
  "test-flakiness/no-long-text-match": "error",
  "test-flakiness/no-promise-race": "error",
  "test-flakiness/no-test-focus": "error",
  "test-flakiness/no-unconditional-wait": "error",
  "test-flakiness/no-viewport-dependent": "error",
};

// Files listed in `.quality-exceptions` pre-date the gate. Their findings are
// downgraded to WARNINGS (still visible, don't block) so the gate ships without
// a mass refactor; any file NOT listed stays a hard error.
//
// The list is now BURNED DOWN and the file is deleted, so this returns []
// and every file is a hard error. It began at 33 entries: 13 source files
// carrying 84 complexity findings and 20 test-story files carrying 272
// flakiness findings.
//
// The file is deleted rather than left empty on purpose. The CI ratchet reads
// it with `listed_now="$(grep -vE '^\s*(#|$)' .quality-exceptions | ...)"`
// under `set -e -o pipefail` and no `|| true`, so a file holding only comments
// makes grep match nothing, exit 1, and take the whole step down with no error
// message. A missing file is a state that step handles explicitly and cleanly
// ("No .quality-exceptions file — nothing to enforce", exit 0).
//
// Re-adding the file to grandfather something would be a regression. Prefer
// fixing the finding; where a flagged construct is genuinely the subject under
// test, an inline disable carrying its reason is narrower than a whole-file
// exemption.
export function loadExceptions() {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    return readFileSync(join(here, ".quality-exceptions"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      // Escape minimatch metacharacters so Next.js route paths such as
      // `app/(admin)/[tenantSlug]/page.tsx` match literally, not as globs.
      .map((p) => p.replace(/[()[\]{}*?!+@]/g, "\\$&"));
  } catch {
    return [];
  }
}
