// The strict-inputs gate: a package's REQUEST input schemas refuse an unknown
// key instead of stripping it (FUT-4729, owner 2026-11-11).
//
// Scope: shipped package source (`packages/*/src/**`, see
// `./lib/shipped-source.mjs`). What counts as an input schema, and what a
// non-strict one looks like, is `./lib/strict-inputs.mjs`.
//
// THE LEDGER `.strict-inputs-exceptions.json` holds two kinds of entry:
//
//   - `exempt`: a schema that parses a THIRD PARTY's payload (payment webhook,
//     provider OAuth), listed as `path::name`, never by path. Temporary by the
//     owner's decision: a week of observation in the host (FUT-4733), then a
//     separate change makes it strict and deletes the entry. None exists today:
//     those parsers are hand-rolled and hold no Zod schema, so a schema added
//     there is a first-party input until someone argues otherwise by name.
//     Other exemptions (stored config, a signed cookie) are argued the same way.
//   - `grandfathered`: an input schema that predates the gate (`path::name`).
//     Shrink-only against the merge base, and touch-must-fix: editing the file
//     obliges the same PR to make the schema strict and delete the line.
//
// Plain node over the checkout, no install. `--findings` prints the current
// finding set, which is how the ledger is authored.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { checkLedger, classifyEntry, readLedger, summarize } from "./lib/exception-ledger.mjs";
import { inScope } from "./lib/shipped-source.mjs";
import { newDebt, nonStrictInputs, touchMustFix } from "./lib/strict-inputs.mjs";

const LABEL = "[strict-inputs]";
const LEDGER_PATH = ".strict-inputs-exceptions.json";

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Every finding in the checkout, keyed `path::name`. */
export function scanRepo() {
  const tracked = (git("ls-files") ?? "").split("\n").filter(Boolean);
  return new Map(tracked.filter((path) => inScope(path) && existsSync(path)).flatMap(findingsOf));
}

/** The `[key, detail]` findings of one in-scope file. */
function findingsOf(path) {
  return [...nonStrictInputs(readFileSync(path, "utf8"))].map(([name, { line, reasons }]) => [
    `${path}::${name}`,
    `${path}:${line} ${name}: ${reasons.join(", ")}`,
  ]);
}

/** The shrink-only + touch-must-fix pair, held against the merge base. */
function ratchetFailures(headLedger) {
  const baseRef =
    process.env.STRICT_INPUTS_BASE_REF ??
    (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
  const mergeBase = git("merge-base", "HEAD", baseRef);
  const pending = [...headLedger.values()].filter((entry) => entry.kind === "grandfathered").length;
  if (!mergeBase) {
    if (pending === 0) return [];
    return [
      `cannot resolve a merge base against ${baseRef} while ${pending} grandfathered ` +
        `entr(y/ies) exist — fetch the base branch (the ratchet must not be skippable)`,
    ];
  }
  const baseRaw = git("show", `${mergeBase}:${LEDGER_PATH}`);
  const baseLedger =
    baseRaw === null
      ? null
      : new Map(Object.entries(JSON.parse(baseRaw)).map(([key, value]) => [key, classifyEntry(value)]));
  const changedFiles = (git("diff", "--name-only", mergeBase) ?? "").split("\n").filter(Boolean);
  return [
    ...newDebt({ baseLedger, headLedger, ledgerPath: LEDGER_PATH }),
    ...touchMustFix({ changedFiles, headLedger, ledgerPath: LEDGER_PATH }),
  ];
}

function main() {
  const findings = scanRepo();
  if (process.argv.includes("--findings")) {
    for (const [key, detail] of [...findings].sort()) console.log(`${key}\t${detail}`);
    return;
  }
  const ledger = readLedger(LEDGER_PATH, { existsSync, readFileSync });
  const checked = checkLedger({
    findings: new Set(findings.keys()),
    ledger,
    ledgerPath: LEDGER_PATH,
    unlisted: (key) =>
      `request input is not strict: ${findings.get(key)} — use z.strictObject (or .strict()) so an ` +
      `unknown key answers 422 instead of being dropped. Third-party payloads are the only exception ` +
      `and are argued in ${LEDGER_PATH}.`,
  });
  const failures = [...checked.failures, ...ratchetFailures(ledger)];
  if (failures.length > 0) {
    console.error(`${LABEL} ${failures.length} violation(s):`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    summarize({
      label: LABEL,
      total: findings.size,
      noun: "non-strict input schema(s)",
      counts: checked.counts,
      burndown: "editing a file with pending entries obliges that PR to make them strict",
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
