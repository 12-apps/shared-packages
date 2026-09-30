#!/usr/bin/env node
// Proves the ui-stories-types gate BITES (FUT-2699).
//
// "0 new findings" has two causes that look identical from outside: the
// stories are clean, or the gate stopped seeing. So every rule the ticket's
// Done-when names has a fixture that must fail it — a new erroring file, a
// listed file whose count rose, a listed file that is now clean — plus the
// two escape hatches (a first run against no ledger on main, a branch that
// changed the project/gate itself) that must NOT fail, and the tsc-output
// parser gets its own fixture so a change to tsc's message format is caught
// here instead of as a silent "0 errors" the next time it runs for real.
//
// Pure: `evaluate` takes fabricated counts, ledgers and baselines — no tsc,
// no git. Chained before the gate in `quality:ui-stories-types`, so this
// cannot land as a file nothing runs.
import { classifyEntry } from "./lib/exception-ledger.mjs";
import { parseErrors } from "./lib/ui-stories-types-collect.mjs";
import { evaluate, findingOf, parseFinding } from "./lib/ui-stories-types-evaluate.mjs";

const LABEL = "[ui-stories-types selftest]";
const failures = [];

const ledgerOf = (entries) => new Map(Object.entries(entries).map(([k, v]) => [k, classifyEntry(v)]));
const REASON = "grandfathered: pre-existing type error in a story that predates the stories type-check lane (FUT-2699)";

const A = "packages/ui/src/components/typography/Heading/Heading.stories.tsx";
const B = "packages/ui/src/components/data-display/DataGrid/DataGrid.stories.tsx";
const C = "packages/ui/src/components/feedback/Sonner/Sonner.stories.tsx";

function expectFail(name, result, match) {
  if (result.failures.length === 0) {
    failures.push(`${name}: expected a failure, got none`);
  } else if (!result.failures.some((f) => f.includes(match))) {
    failures.push(`${name}: expected a failure mentioning "${match}", got:\n    ${result.failures.join("\n    ")}`);
  }
}

function expectClean(name, result) {
  if (result.failures.length > 0) failures.push(`${name}: expected no failures, got:\n    ${result.failures.join("\n    ")}`);
}

// 1. A clean run: the ledger matches this run's counts exactly, and main allows them.
expectClean("clean run", evaluate({
  counts: new Map([[A, 2]]),
  detail: new Map(),
  ledger: ledgerOf({ [findingOf(A, 2)]: REASON }),
  base: { counts: new Map([[A, 2]]) },
  scannerChanged: () => false,
}));

// 2. A NEW erroring file that is not on the ledger at all.
expectFail("new erroring file", evaluate({
  counts: new Map([[A, 2], [B, 3]]),
  detail: new Map([[B, [`${B}:10 TS2322: example`]]]),
  ledger: ledgerOf({ [findingOf(A, 2)]: REASON }),
  base: { counts: new Map([[A, 2]]) },
  scannerChanged: () => false,
}), findingOf(B, 3));

// 3. A LISTED file whose count RISES — must fail on the ratchet, by name, with the exact allowance.
expectFail("listed file's count rises", evaluate({
  counts: new Map([[A, 5]]),
  detail: new Map(),
  ledger: ledgerOf({ [findingOf(A, 2)]: REASON }),
  base: { counts: new Map([[A, 2]]) },
  scannerChanged: () => false,
}), "origin/main allows 2");

// 4. A LISTED file that is now CLEAN (0 errors) — stale, must be deleted.
expectFail("listed file now clean", evaluate({
  counts: new Map(),
  detail: new Map(),
  ledger: ledgerOf({ [findingOf(C, 4)]: REASON }),
  base: { counts: new Map([[C, 4]]) },
  scannerChanged: () => false,
}), "stale exception");

// 5. The scanner (tsconfig.stories.json or the gate) changed on this branch: a
// risen, ALREADY-UPDATED count is let through with a note, not a failure.
{
  const result = evaluate({
    counts: new Map([[A, 5]]),
    detail: new Map(),
    ledger: ledgerOf({ [findingOf(A, 5)]: REASON }),
    base: { counts: new Map([[A, 2]]) },
    scannerChanged: () => true,
  });
  expectClean("scanner changed lets a risen count through", result);
  if (!result.note) failures.push("scanner changed: expected a note explaining why, got none");
}

// 6. origin/main cannot be read at all — the ratchet must refuse to run silently, whatever the ledger says.
expectFail("origin/main unreachable", evaluate({
  counts: new Map([[A, 2]]),
  detail: new Map(),
  ledger: ledgerOf({ [findingOf(A, 2)]: REASON }),
  base: { unreachable: true },
  scannerChanged: () => false,
}), "could not be read");

// 7. First run — no ledger on origin/main yet (this gate's own introduction) — must not fail on the ratchet.
expectClean("first run (no ledger on main)", evaluate({
  counts: new Map([[A, 2]]),
  detail: new Map(),
  ledger: ledgerOf({ [findingOf(A, 2)]: REASON }),
  base: { firstRun: true },
  scannerChanged: () => false,
}));

// findingOf / parseFinding round-trip, the same shape the ledger keys on.
{
  const round = parseFinding(findingOf(A, 7));
  if (!round || round.file !== A || round.count !== 7) failures.push("findingOf/parseFinding do not round-trip");
}

// The tsc-output parser: a real error, a wrapped multi-line message (the
// continuation must NOT be double-counted), and a config-level error whose
// "file" is not a story (a broken tsconfig.stories.json, not story debt).
{
  const OUTPUT = [
    `${A}(12,3): error TS2322: Type '{ children: string; }' is not assignable to type 'never'.`,
    `${A}(40,8): error TS2741: Property 'dismissLabel' is missing in type '{ open: true; }' but required in type 'Props'.`,
    `  Property 'dismissLabel' is missing in type '{ open: true; }'.`,
    `tsconfig.stories.json(3,4): error TS5069: Option 'declarationMap' cannot be specified without specifying option 'declaration'.`,
    "",
  ].join("\n");
  const { counts, detail, configErrors } = parseErrors(OUTPUT);
  if (counts.get(A) !== 2) failures.push(`parser: expected 2 errors on ${A}, got ${counts.get(A)}`);
  if ((detail.get(A) ?? []).length !== 2) failures.push(`parser: expected 2 example lines for ${A}, got ${JSON.stringify(detail.get(A))}`);
  if (configErrors.length !== 1) failures.push(`parser: expected 1 config-level error, got ${JSON.stringify(configErrors)}`);
}

if (failures.length > 0) {
  console.error(`${LABEL} ${failures.length} failure(s):\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`${LABEL} ok — new debt, a risen count, a stale entry and an unreachable main all fail; a first run ` +
  `and a scanner change do not; the tsc-output parser groups by file and isolates config errors.`);
