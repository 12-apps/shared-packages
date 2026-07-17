#!/usr/bin/env node
/**
 * Knip ratchet gate.
 *
 * knip on its own would flag the current in-flight API (repository getters,
 * payment result types, a tenant hook) that is implemented but not wired yet —
 * not dead code, so we don't delete it. Instead we grandfather the CURRENT
 * findings into .knip-exceptions.json and enforce that the list can only SHRINK:
 *
 *   - Any knip finding NOT in the baseline  → FAIL (new dead code — the ratchet).
 *   - Any baseline entry no longer flagged  → FAIL (resolved — remove it so the
 *     exceptions file monotonically shrinks; run with --update to reseed).
 *
 * So new unused files/exports/deps hard-fail, and as the grandfathered API gets
 * wired up (or removed) the exceptions file is forced smaller. It can never grow.
 *
 * Usage:
 *   node scripts/knip-gate.mjs            # gate (CI + pnpm quality:knip)
 *   node scripts/knip-gate.mjs --update   # reseed the baseline from current knip
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const EXCEPTIONS = ".knip-exceptions.json";
const UPDATE = process.argv.includes("--update");
const CATEGORIES = [
  "files",
  "exports",
  "types",
  "dependencies",
  "devDependencies",
  "unlisted",
  "unresolved",
];

function runKnip() {
  const out = execFileSync(
    "pnpm",
    ["exec", "knip", "--reporter", "json", "--no-exit-code"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

const issueKeys = (report, field) =>
  (report.issues || []).flatMap((it) =>
    (it[field] || []).map((x) => `${it.file}#${x.name}`),
  );

// Flatten a knip report to a sorted key list per category.
function currentKeys(report) {
  const keys = { files: [...(report.files || [])].sort() };
  for (const cat of CATEGORIES.slice(1)) keys[cat] = issueKeys(report, cat).sort();
  return keys;
}

function loadBaseline() {
  if (!existsSync(EXCEPTIONS)) return null;
  const base = JSON.parse(readFileSync(EXCEPTIONS, "utf8"));
  for (const cat of CATEGORIES) base[cat] = base[cat] || [];
  return base;
}

function diff(current, baseline, cat) {
  const baseSet = new Set(baseline[cat]);
  const currSet = new Set(current[cat]);
  return {
    added: current[cat].filter((k) => !baseSet.has(k)),
    stale: baseline[cat].filter((k) => !currSet.has(k)),
  };
}

const current = currentKeys(runKnip());

if (UPDATE) {
  writeFileSync(EXCEPTIONS, JSON.stringify(current, null, 2) + "\n");
  const total = CATEGORIES.reduce((n, c) => n + current[c].length, 0);
  console.log(`[knip-gate] reseeded ${EXCEPTIONS} with ${total} grandfathered finding(s).`);
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(`[knip-gate] ${EXCEPTIONS} missing — run: node scripts/knip-gate.mjs --update`);
  process.exit(2);
}

const added = CATEGORIES.flatMap((c) => diff(current, baseline, c).added.map((k) => `${c}: ${k}`));
const stale = CATEGORIES.flatMap((c) => diff(current, baseline, c).stale.map((k) => `${c}: ${k}`));

if (added.length > 0) {
  console.error(`[knip-gate] NEW unused findings not in ${EXCEPTIONS} (fix them — the exceptions file cannot grow):`);
  added.forEach((k) => console.error("  ✗ " + k));
}
if (stale.length > 0) {
  console.error(`[knip-gate] resolved entries still in ${EXCEPTIONS} — remove them (run --update):`);
  stale.forEach((k) => console.error("  ⤺ " + k));
}
if (added.length > 0 || stale.length > 0) process.exit(1);

const total = CATEGORIES.reduce((n, c) => n + baseline[c].length, 0);
console.log(`[knip-gate] clean — ${total} grandfathered finding(s), none added. ✅`);
