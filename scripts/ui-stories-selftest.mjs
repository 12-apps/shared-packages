#!/usr/bin/env node
// Proves the ui-stories gate BITES (FUT-2619).
//
// A gate over test results has one failure mode that looks exactly like
// success: it stops seeing failures. So every rule the gate claims has a case
// here that breaks it and must fail — and the cases that must PASS (a listed
// failure, a quarantined failure) are here too, because a gate that cries wolf
// gets switched off.
//
// Pure: the fixtures are an in-memory Storybook index and the Jest JSON the
// test-runner writes, handed to the gate's own `evaluate`. Chained before the
// gate in `quality:ui-stories`, so this cannot land as a file nothing runs.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { classifyEntry, readLedger } from "./lib/exception-ledger.mjs";
import { evaluate, keyOf, LEDGER_PATH, specOf } from "./lib/ui-stories-evaluate.mjs";

const LABEL = "[ui-stories selftest]";
const TODAY = "2026-09-25";
const DIALOG = "./src/components/overlays/Dialog/Dialog.test.stories.tsx";
const FOCUS = keyOf("Overlays/Dialog/Tests", "🎯 Focus Management Test");
const OPENS = keyOf("Overlays/Dialog/Tests", "Opens");
const UPLOAD = keyOf("Form/UploadButton/Tests", "State Change Test");
const WHY = "expects English copy (/upload file/i) on a button that reads 'Enviar arquivo'";

const story = (id, title, name, importPath) => ({ type: "story", id, title, name, importPath, tags: ["dev", "test"] });
const INDEX = {
  v: 5,
  entries: {
    a: story("overlays-dialog-tests--focus", "Overlays/Dialog/Tests", "🎯 Focus Management Test", DIALOG),
    b: story("overlays-dialog-tests--opens", "Overlays/Dialog/Tests", "Opens", DIALOG),
    c: story("form-uploadbutton-tests--state", "Form/UploadButton/Tests", "State Change Test",
      "./src/components/form/UploadButton/UploadButton.test.stories.tsx"),
    // Not a test file: out of scope, and must not be selected.
    d: story("overlays-dialog--default", "Overlays/Dialog", "Default", "./src/components/overlays/Dialog/Dialog.stories.tsx"),
    e: { type: "docs", id: "overlays-dialog--docs", title: "Overlays/Dialog", name: "Docs", importPath: DIALOG, tags: [] },
  },
};

/** Jest JSON for `failing` keys failed and every other in-scope story passed. */
function results(failing = [], { omit = [], extra = [] } = {}) {
  const keys = [FOCUS, OPENS, UPLOAD].filter((k) => !omit.includes(k)).concat(extra);
  const assertionResults = keys.map((k) => ({
    ancestorTitles: k.split(" › "),
    status: failing.includes(k) ? "failed" : "passed",
    failureMessages: failing.includes(k) ? ["\u001b[31mexpected false to be true\u001b[39m\n    at play"] : [],
  }));
  return { testResults: [{ name: "/tmp/x/all-tests.test.js", status: "failed", assertionResults }] };
}

const ledgerOf = (entries) => new Map(Object.entries(entries).map(([k, v]) => [k, classifyEntry(v)]));
const MAIN_LISTS = (...keys) => ({ keys: new Set(keys) });
const quarantined = (over = {}) => ({
  spec: specOf(DIALOG), titlePattern: "Dialog/Tests › 🎯 Focus", reason: "intermittent focus race",
  ticket: "FUT-9999", addedAt: "2026-09-20", expiresAt: "2026-10-20", ...over,
});

function run({ failing = [], ledger = {}, quarantine = [], base = MAIN_LISTS(...Object.keys(ledger)), ...rest } = {}) {
  return evaluate({
    index: INDEX, results: rest.results ?? results(failing), ledger: ledgerOf(ledger), quarantine, today: TODAY, base,
  });
}
const fails = (r, re) => r.failures.some((f) => re.test(f));
const green = (r) => r.failures.length === 0;

const cases = [
  // --- the three the ticket asks for -------------------------------------
  [() => green(run()), "all in-scope stories passing, empty ledger: green"],
  [() => fails(run({ failing: [FOCUS] }), /^FAILED: Overlays\/Dialog\/Tests › 🎯 Focus Management Test \[overlays-dialog-tests--focus\]/),
    "(1) an UNLISTED failure fails, and the log line names the story, its id and file"],
  [() => fails(run({ failing: [FOCUS] }), /expected false to be true/) && !fails(run({ failing: [FOCUS] }), /\u001b/),
    "(1) the failure carries the error's first lines, colourless"],
  [() => green(run({ failing: [UPLOAD], ledger: { [UPLOAD]: WHY } })), "a LISTED failure passes"],
  [() => fails(run({ ledger: { [UPLOAD]: WHY } }), /^stale exception: Form\/UploadButton\/Tests › State Change Test/),
    "(2) a listed story that now PASSES fails as stale"],
  [() => fails(run({ failing: [UPLOAD, FOCUS], ledger: { [UPLOAD]: WHY, [FOCUS]: WHY }, base: MAIN_LISTS(UPLOAD) }), /lists 2 stories, origin\/main lists 1/),
    "(3) the ledger cannot GROW against origin/main"],
  [() => fails(run({ failing: [FOCUS], ledger: { [FOCUS]: WHY }, base: MAIN_LISTS(UPLOAD) }), /is new to/),
    "(3) nor swap a fixed story for a new failure at the same count"],
  [() => green(run({ failing: [UPLOAD], ledger: { [UPLOAD]: WHY }, base: MAIN_LISTS(UPLOAD, FOCUS) })),
    "(3) shrinking against origin/main passes"],
  [() => fails(run({ base: { unreachable: true } }), /origin\/main could not be read/),
    "(3) an unreadable origin/main fails rather than skipping the ratchet"],
  [() => green(run({ failing: [UPLOAD], ledger: { [UPLOAD]: WHY }, base: { firstRun: true } })),
    "(3) no ledger on origin/main yet (the landing PR) is not a growth"],

  // --- the ledger's shape -------------------------------------------------
  [() => fails(run({ failing: [UPLOAD], ledger: { [UPLOAD]: { kind: "exempt", why: WHY } } }), /only "grandfathered"/),
    "an EXEMPT entry fails — a permanently failing test is not a thing"],
  [() => fails(run({ failing: [UPLOAD], ledger: { [UPLOAD]: "known failure" } }), /must name the cause/),
    "a grandfathered entry whose why is a label, not a cause, fails"],

  // --- the flaky quarantine ------------------------------------------------
  [() => green(run({ failing: [FOCUS], quarantine: [quarantined()] })),
    "an ACTIVE quarantine entry (spec + titlePattern) makes its story's failure not fail the job"],
  [() => run({ failing: [FOCUS], quarantine: [quarantined()] }).notes.some((n) => /FUT-9999/.test(n)),
    "a quarantined failure is still reported, with its ticket"],
  [() => fails(run({ failing: [FOCUS], quarantine: [quarantined({ expiresAt: "2026-09-24" })] }), /^FAILED: Overlays\/Dialog\/Tests › 🎯 Focus/),
    "an EXPIRED quarantine entry is no longer honoured — the failure counts again"],
  [() => fails(run({ failing: [FOCUS], quarantine: [quarantined({ spec: "packages/ui/src/Other.test.stories.tsx" })] }), /^FAILED/),
    "a quarantine entry for another spec does not cover the story (spec is resolved through importPath)"],
  [() => fails(run({ failing: [OPENS], quarantine: [quarantined()] }), /^FAILED: Overlays\/Dialog\/Tests › Opens/),
    "the titlePattern is matched against '<title> › <story name>' — a sibling story is not covered"],
  [() => fails(run({ failing: [FOCUS], ledger: { [FOCUS]: WHY }, quarantine: [quarantined()] }), /broken or flaky, pick one/),
    "a story on the ledger AND in the quarantine fails"],

  // --- the selection -------------------------------------------------------
  [() => fails(run({ results: results([], { omit: [OPENS] }) }), /Opens .* did not run/),
    "a test story that produced no result fails — a `!test` tag cannot switch a suite off"],
  [() => fails(run({ results: results([], { extra: [keyOf("Overlays/Dialog", "Default")] }) }), /the selection widened/),
    "a story from outside *.test.stories.tsx fails — the pattern must not widen"],
  [() => fails(run({ results: { testResults: [] } }), /no stories at all/), "an empty run fails"],
  [() => fails(run({ results: { testResults: [{ name: "/t/x-tests.test.js", status: "failed", message: "SyntaxError", assertionResults: [] }] } }), /failed to run: x-tests\.test\.js: SyntaxError/),
    "a suite that dies before running a story fails"],
];

const failures = cases.filter(([check]) => !check()).map(([, label]) => label);

// The real ledger parses and every entry clears the bar — a malformed file
// must fail here, before a 5-minute browser run, not after it.
const real = readLedger(fileURLToPath(new URL(`../${LEDGER_PATH}`, import.meta.url)), { existsSync, readFileSync });
const bad = run({ ledger: Object.fromEntries(real), base: { firstRun: true } })
  .failures.filter((f) => /only "grandfathered"|must name the cause/.test(f));
failures.push(...bad.map((f) => `${LEDGER_PATH}: ${f}`));

if (failures.length > 0) {
  console.error(`${LABEL} ${failures.length} failure(s):\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`${LABEL} ok — ${cases.length} cases; ${LEDGER_PATH} holds ${real.size} well-formed entr${real.size === 1 ? "y" : "ies"}.`);
