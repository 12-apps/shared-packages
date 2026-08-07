#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import { PROVIDER_NAMES } from "../eslint.payments-portability.rules.mjs";

/**
 * Proves the payments-portability gate BITES (FUT-562).
 *
 * `pnpm quality:portability` reporting zero errors has two possible causes: the
 * tree is portable, or the gate's `files:` globs match nothing. Those look
 * identical from the outside, and the second one is worse than having no gate —
 * it reports a safety it is not providing, and nobody checks again.
 *
 * So each rule ships with a fixture that violates it and a fixture that does
 * the same job correctly. Both go through the REAL config
 * (`eslint.payments-portability.config.mjs`, no reimplementation) under a
 * pretend file path inside the package or consumer the rule is scoped to, using
 * `lintText` so no file is ever written into the tree. If a `violates-` fixture
 * comes back clean the gate has stopped firing; if a `clean-` fixture comes
 * back dirty the gate has started crying wolf. Either fails this script.
 *
 * The pretend paths are the part that catches a moved package: they name real
 * locations (`packages/payments/backend/src/...`), so a rename that unhooks the
 * glob unhooks the fixture too.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIXTURES = join(HERE, "payments-portability-fixtures");
const CONFIG = join(ROOT, "eslint.payments-portability.config.mjs");

const RULE1 = "payments/no-host-imports";
const RULE2 = "payments/no-provider-name-literal";
const RULE3 = "payments/frontend-types-only";

/**
 * `as` is where the fixture PRETENDS to live. It has to be a path the gate's
 * globs actually select, which is exactly what makes this a test of the globs
 * and not only of the rule bodies.
 *
 * `atLeast` rather than an exact count on the violating fixtures, so adding a
 * case to one does not need this table edited while zero still fails loudly.
 * The clean fixtures pin `exact: 0` — a gate that started crying wolf is its
 * own kind of broken.
 */
const CASES = [
  {
    rule: RULE1,
    fixture: "violates-rule1-host-imports.ts",
    as: "packages/payments/backend/src/__portability_selftest__.ts",
    atLeast: 3,
    why: "sibling package, escaping relative path, and a reach into harness/",
  },
  {
    rule: RULE1,
    fixture: "clean-rule1-host-imports.ts",
    as: "packages/payments/backend/src/__portability_selftest__.ts",
    atLeast: 0,
    exact: 0,
    why: "node builtins, the sibling half of the package, and in-package relatives",
  },
  {
    rule: RULE2,
    fixture: "violates-rule2-provider-literal.ts",
    as: "packages/ui/src/__portability_selftest__.ts",
    atLeast: 4,
    why: "plain literal, vendor-keyed record, template chunk, import specifier",
  },
  {
    rule: RULE2,
    fixture: "violates-rule2-provider-literal.tsx",
    as: "packages/ui/src/__portability_selftest__.tsx",
    atLeast: 2,
    why: "JSX attribute string and JSX text",
  },
  {
    rule: RULE2,
    fixture: "clean-rule2-provider-literal.ts",
    as: "packages/ui/src/__portability_selftest__.ts",
    atLeast: 0,
    exact: 0,
    why: "striped / stripeColor / milestone must not trip the word-bounded match",
  },
  {
    rule: RULE3,
    fixture: "violates-rule3-frontend-runtime.ts",
    as: "packages/payments/frontend/src/__portability_selftest__.ts",
    atLeast: 7,
    why: "named value, value beside inline types, default, namespace, side-effect, re-export, dynamic import",
  },
  {
    rule: RULE3,
    fixture: "violates-rule3-relative-backend.ts",
    as: "packages/payments/frontend/src/__portability_selftest__.ts",
    atLeast: 2,
    why: "a relative climb into the sibling backend never spells the package name",
  },
  {
    rule: RULE3,
    fixture: "clean-rule3-story-helper.ts",
    as: "packages/payments/frontend/src/stories/__portability_selftest__.ts",
    why: "story helpers never ship — `files` carries !src/stories/**",
  },
  {
    rule: RULE3,
    fixture: "clean-rule3-frontend-runtime.ts",
    as: "packages/payments/frontend/src/__portability_selftest__.ts",
    atLeast: 0,
    exact: 0,
    why: "import type, inline type specifiers, export type … from",
  },
];

/**
 * The scoping half of the proof: the same violating text at a path the rule is
 * NOT meant to cover must come back clean. Without this a rule that fired on
 * everything everywhere would pass the table above and quietly make the repo
 * unlintable in ways nobody asked for.
 */
const SCOPE_CASES = [
  {
    rule: RULE2,
    fixture: "violates-rule2-provider-literal.ts",
    as: "packages/payments/backend/src/__portability_selftest__.ts",
    why: "provider names are legal INSIDE the payments package",
  },
  {
    rule: RULE2,
    fixture: "violates-rule2-provider-literal.ts",
    as: "packages/ui/src/__tests__/__portability_selftest__.ts",
    why: "tests are on the ticket's allowlist",
  },
  {
    rule: RULE3,
    fixture: "violates-rule3-frontend-runtime.ts",
    as: "packages/payments/backend/src/__portability_selftest__.ts",
    why: "the BACKEND may of course use its own runtime values",
  },
];

const eslint = new ESLint({
  cwd: ROOT,
  overrideConfigFile: CONFIG,
  // The fixtures are ignored where they physically live; here they are linted
  // under a pretend path that nothing ignores, so this only guards against a
  // future ignore entry silently voiding the proof.
  warnIgnored: false,
});

const failures = [];

async function messagesFor(fixture, as, rule) {
  const code = readFileSync(join(FIXTURES, fixture), "utf8");
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, as) });
  const fatal = (result?.messages ?? []).filter((m) => m.fatal);
  if (fatal.length > 0) {
    failures.push(
      `${fixture} @ ${as}: fixture failed to PARSE — ${fatal[0].message}`,
    );
  }
  return (result?.messages ?? []).filter((m) => m.ruleId === rule);
}

for (const { rule, fixture, as, atLeast, exact, why } of CASES) {
  const found = await messagesFor(fixture, as, rule);
  const label = `${rule} :: ${fixture} @ ${as}`;
  if (exact !== undefined && found.length !== exact) {
    failures.push(
      `${label}\n    expected exactly ${exact} report(s) (${why}), got ${found.length}:\n` +
        found.map((m) => `      line ${m.line}: ${m.message}`).join("\n"),
    );
  } else if (exact === undefined && found.length < atLeast) {
    failures.push(
      `${label}\n    expected at least ${atLeast} report(s) (${why}), got ${found.length}. ` +
        `The rule has stopped firing — check the \`files:\` glob before assuming the fixture is wrong.`,
    );
  } else {
    console.log(`  ok  ${label} → ${found.length} report(s)`);
  }
}

for (const { rule, fixture, as, why } of SCOPE_CASES) {
  const found = await messagesFor(fixture, as, rule);
  const label = `${rule} :: ${fixture} @ ${as} (out of scope)`;
  if (found.length > 0) {
    failures.push(
      `${label}\n    expected 0 reports — ${why} — got ${found.length}:\n` +
        found.map((m) => `      line ${m.line}: ${m.message}`).join("\n"),
    );
  } else {
    console.log(`  ok  ${label} → 0 reports`);
  }
}

// The provider list is DERIVED from packages/payments/backend/src/providers/
// catalog.ts. If that scrape ever returns a short list, rule 2 silently stops
// covering the missing vendor — so assert the shape here too, where a failure
// names the cause.
const EXPECTED_PROVIDERS = ["infinitepay", "pagbank", "pagseguro", "stone", "stripe"];
for (const name of EXPECTED_PROVIDERS) {
  if (!PROVIDER_NAMES.includes(name)) {
    failures.push(
      `provider list derived from catalog.ts is missing "${name}" — got [${PROVIDER_NAMES.join(", ")}]. ` +
        `Rule 2 would not catch it. If an adapter was genuinely removed, drop it from EXPECTED_PROVIDERS here too.`,
    );
  }
}
console.log(`  ok  provider names derived from catalog.ts → ${PROVIDER_NAMES.join(", ")}`);

if (failures.length > 0) {
  console.error(
    `\nThe payments-portability gate is not biting (${failures.length} problem(s)):\n`,
  );
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}

console.log(
  `\nAll ${CASES.length + SCOPE_CASES.length} portability-gate cases behaved as expected.`,
);
