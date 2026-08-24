// Proof that `locale-coverage-gate.mjs` bites.
//
// A coverage gate whose matcher misses reports a safety it is not providing,
// which is worse than no gate at all — and this one's matcher is a filename
// rule, the exact kind that goes quietly dead when a convention shifts. So the
// proof ships beside the gate and runs in CI with it, the same arrangement
// `payments-portability-selftest.mjs` uses.
//
// It drives the gate's PURE halves over synthetic paths rather than writing
// files: what can break here is the grouping and the gap-finding, and both are
// exported for exactly this.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { canonicalLocales, findGaps, groupLocaleFiles, localeFileOf } from "./locale-coverage-gate.mjs";

const LABEL = "[locale-coverage:selftest]";
const LOCALES = canonicalLocales(readFileSync("packages/i18n/src/core/locale.ts", "utf8"));

assert.deepEqual(LOCALES, ["pt-BR", "en-US"], "the canonical list is read out of the package");

// --- what counts as a locale file -----------------------------------------

assert.equal(localeFileOf("packages/ui/src/pt-BR.ts", LOCALES)?.family, "");
assert.equal(localeFileOf("packages/ui/src/pt-BR.form.ts", LOCALES)?.family, "form");
assert.equal(localeFileOf("packages/x/src/locales/en-US.ts", LOCALES)?.tag, "en-US");
assert.equal(
  localeFileOf("packages/forms-core/src/br.ts", LOCALES),
  null,
  "a two-letter filename that is not a language-REGION tag must not read as a pack",
);
assert.equal(localeFileOf("packages/x/src/copy.ts", LOCALES), null);
assert.equal(
  localeFileOf("harness/frontend/src/pt-BR.ts", LOCALES),
  null,
  "only package source is in scope",
);

// --- the gap it is supposed to find ----------------------------------------

const halfPorted = groupLocaleFiles(["packages/x/src/pt-BR.ts"], LOCALES);
assert.equal(findGaps(halfPorted, LOCALES).get("packages/x")?.length, 1, "a pt-BR-only pack is a gap");

const ported = groupLocaleFiles(["packages/x/src/pt-BR.ts", "packages/x/src/en-US.ts"], LOCALES);
assert.equal(findGaps(ported, LOCALES).size, 0, "a bilingual pack is not a gap");

// The failure this gate exists for: a pack split per family that grew ONE
// English file and reads as done. Grouping by family is what catches it.
const partial = groupLocaleFiles(
  [
    "packages/x/src/pt-BR.form.ts",
    "packages/x/src/pt-BR.layout.ts",
    "packages/x/src/en-US.form.ts",
  ],
  LOCALES,
);
const lines = findGaps(partial, LOCALES).get("packages/x") ?? [];
assert.equal(lines.length, 1, "the family with no English twin is still reported");
assert.match(lines[0], /family=layout/);

// A file in a DIFFERENT folder must not satisfy a family in this one.
const scattered = groupLocaleFiles(
  ["packages/x/src/react/pt-BR.ts", "packages/x/src/server/en-US.ts"],
  LOCALES,
);
assert.equal(findGaps(scattered, LOCALES).get("packages/x")?.length, 2);

// The other three spellings this repo already uses, each pairing on its family
// rather than on "some English file nearby".
assert.equal(localeFileOf("packages/a/src/setup-guide-pt-BR.ts", LOCALES)?.family, "setup-guide");
assert.equal(localeFileOf("packages/a/src/mail-templates.pt-BR.ts", LOCALES)?.family, "mail-templates");
assert.equal(localeFileOf("packages/a/src/checkout-payment-pt-BR.ts", LOCALES)?.family, "checkout-payment");
assert.equal(
  findGaps(
    groupLocaleFiles(
      ["packages/a/src/setup-guide-pt-BR.ts", "packages/a/src/setup-guide-en-US.ts"],
      LOCALES,
    ),
    LOCALES,
  ).size,
  0,
  "a dash-suffixed pair is complete",
);
assert.equal(
  findGaps(
    groupLocaleFiles(
      ["packages/a/src/setup-guide-pt-BR.ts", "packages/a/src/other-en-US.ts"],
      LOCALES,
    ),
    LOCALES,
  ).get("packages/a")?.length,
  2,
  "an English file for a DIFFERENT family does not complete this one",
);

console.log(
  `${LABEL} ok — the matcher and the gap-finder bite, and every filename spelling ` +
    "this repo uses pairs on its family.",
);
