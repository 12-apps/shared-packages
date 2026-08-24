// Selftest for the shared exception ledger (scripts/lib/exception-ledger.mjs).
//
// The gate that guards the gates. Every case here is a way the split between
// `grandfathered` and `exempt` could quietly stop meaning anything — a kind
// that does not parse, an exemption with no argument behind it, a stale entry
// hiding in the kind that is allowed to be permanent. Each one has to FAIL,
// because a ratchet that only ever passes is decoration.
import { pathToFileURL } from "node:url";

import { KINDS, checkLedger, classifyEntry, summarize } from "./lib/exception-ledger.mjs";

const LABEL = "[exception-ledger]";

// A stand-in for a real argument: long enough and specific enough to pass, and
// deliberately NOT naming a provider — this module is generic, and the repo's
// own lint keeps vendor names inside packages/payments/**.
const ARGUED =
  "the vendor's own dashboard field name, quoted so an owner can find the box; " +
  "translating a vendor label sends someone hunting for a field that does not exist";

/** `checkLedger` over a plain object ledger, for brevity in the cases below. */
function run(findings, entries) {
  return checkLedger({
    findings: new Set(findings),
    ledger: new Map(Object.entries(entries).map(([k, v]) => [k, classifyEntry(v)])),
    ledgerPath: ".test-exceptions.json",
    unlisted: (f) => `unlisted: ${f}`,
  });
}

const cases = [
  // --- the ratchet still ratchets -----------------------------------------
  [
    () => run(["a.ts"], {}).failures.length === 1,
    "an unlisted finding fails — this is the gate itself",
  ],
  [
    () => run([], { "a.ts": "shipped before the gate" }).failures[0]?.startsWith("stale exception:"),
    "a grandfathered entry whose finding is gone fails as stale",
  ],
  [
    () => run([], { "a.ts": { kind: "exempt", why: ARGUED } }).failures[0]?.startsWith("stale exception:"),
    "an EXEMPT entry whose finding is gone also fails as stale — exempt is not a place to hide",
  ],

  // --- the two kinds ------------------------------------------------------
  [
    () => {
      const { failures, counts } = run(["a.ts"], { "a.ts": "shipped before the gate" });
      return failures.length === 0 && counts.grandfathered === 1 && counts.exempt === 0;
    },
    "a bare string still parses, as grandfathered — ledgers migrate when touched, not in a sweep",
  ],
  [
    () => {
      const { failures, counts } = run(["a.ts"], { "a.ts": { kind: "exempt", why: ARGUED } });
      return failures.length === 0 && counts.exempt === 1 && counts.grandfathered === 0;
    },
    "an argued exemption passes and counts as exempt",
  ],
  [
    () => {
      const { counts } = run(["a.ts", "b.ts"], {
        "a.ts": "debt",
        "b.ts": { kind: "exempt", why: ARGUED },
      });
      return counts.grandfathered === 1 && counts.exempt === 1;
    },
    "both counts are reported, so a relabel moves a number rather than losing one",
  ],

  // --- the ways the split could stop meaning anything ---------------------
  [
    () => run(["a.ts"], { "a.ts": { kind: "exmept", why: ARGUED } }).failures[0]?.includes('"grandfathered"'),
    "a misspelled kind fails and names the two legal kinds",
  ],
  [
    () => run(["a.ts"], { "a.ts": { why: ARGUED } }).failures.length === 1,
    "an entry with no kind fails rather than defaulting to the permissive one",
  ],
  [
    () => run(["a.ts"], { "a.ts": { kind: "exempt", why: "vendor" } }).failures[0]?.includes("written argument"),
    "an exemption whose why is a label, not an argument, fails",
  ],
  [
    () => run(["a.ts"], { "a.ts": { kind: "exempt", why: "PERMANENT" } }).failures.length === 1,
    "the old PERMANENT prefix on its own is not an argument either",
  ],
  [
    () => run(["a.ts"], { "a.ts": { kind: "exempt", why: "" } }).failures.length === 1,
    "an exemption with no why at all fails",
  ],
  [
    () => run(["a.ts"], { "a.ts": { kind: "grandfathered", why: "x" } }).failures.length === 0,
    "grandfathered debt needs no essay — it is meant to leave, not to be defended",
  ],

  // --- the summary line ---------------------------------------------------
  [
    () =>
      summarize({
        label: LABEL,
        total: 3,
        noun: "file(s)",
        counts: { grandfathered: 0, exempt: 3 },
        burndown: "n/a",
      }).includes("burn-down complete"),
    "zero grandfathered reads as complete, not as three outstanding items",
  ],
  [
    () =>
      summarize({
        label: LABEL,
        total: 3,
        noun: "file(s)",
        counts: { grandfathered: 2, exempt: 1 },
        burndown: "the adoption wave",
      }).includes("shrink-only"),
    "any remaining debt keeps the shrink-only wording",
  ],
  [() => KINDS.length === 2, "exactly two kinds — a third would be a way to not decide"],
];

function main() {
  const failed = cases.filter(([assertion]) => {
    try {
      return !assertion();
    } catch {
      return true;
    }
  });
  for (const [, name] of failed) console.error(`${LABEL} selftest FAILED: ${name}`);
  if (failed.length > 0) process.exit(1);
  console.log(`${LABEL} ${cases.length} case(s) pass.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
