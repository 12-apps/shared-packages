#!/usr/bin/env node
/**
 * Selftest for `.workflow/synapsys/no-whole-suite-runs.md` (FUT-4348): the block
 * memory refuses a command that runs a whole suite and lets through every
 * selective form and every command that only mentions one.
 *
 * The trigger is byte-identical to future-pay's, where the full table (60+ rows,
 * plus synapsys's own matcher) lives in scripts/__tests__/whole-suite-memory.test.mjs
 * and the trigger is generated from scripts/lib/whole-suite-trigger.mjs. This
 * pins the rows that matter in THIS repository, through the regex as synapsys
 * reads it: each comma-separated `Bash:<regex>` spec, case-insensitive, against
 * JSON.stringify(tool_input).
 *
 * Usage: node scripts/no-whole-suite-runs-selftest.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = "pnpm";
const V = "vitest";
const T = "turbo";

const TABLE = [
  ["block", `${P} test:all`],
  ["block", `${T} run test`],
  ["block", `npx ${T} run test --filter=@12-apps/ui`],
  ["block", `${P} --filter @12-apps/payments-backend test`],
  ["block", `${P} -C packages/ui test`],
  ["block", `cd packages/payments/frontend && ${P} test`],
  ["block", `cd packages/ui; npx ${V} run`],
  ["block", `npx ${V} run`],
  ["block", `cd packages/ui && timeout 600 ${P} test`],
  ["block", `${P} -C packages/ui exec ${V} run`],
  ["block", `npx ${V} watch`],
  ["allow", `grep -rnE "foo|${T} run test" docs`],
  ["allow", `rg -n 'x|${P} --filter web test|y' docs`],
  ["allow", `npx ${V} run -t "adds the fee" src/fee.test.ts`],
  ["allow", `${P} test`],
  ["allow", `${P} test:changed`],
  ["allow", `${P} test:changed --uncommitted`],
  ["allow", `npx ${V} run src/a.test.ts`],
  ["allow", `npx ${V} related --run src/a.ts`],
  ["allow", `npx ${V} run --changed`],
  ["allow", `grep -rn "${T} run test" docs`],
  ["allow", `echo "never ${P} test:all"`],
];

const line = readFileSync(join(ROOT, ".workflow", "synapsys", "no-whole-suite-runs.md"), "utf8")
  .split("\n")
  .find((l) => l.startsWith("trigger_pretool: "));
if (!line) {
  console.error("no-whole-suite-runs: no trigger_pretool line");
  process.exit(1);
}
const specs = line
  .slice("trigger_pretool: ".length)
  .split(",")
  .map((spec) => new RegExp(spec.slice(spec.indexOf(":") + 1), "i"));

const wrong = TABLE.filter(([want, command]) => {
  const blob = JSON.stringify({ command, description: "Run tests" });
  return (specs.some((re) => re.test(blob)) ? "block" : "allow") !== want;
});
if (wrong.length) {
  for (const [want, command] of wrong) console.error(`no-whole-suite-runs: expected ${want}: ${command}`);
  process.exit(1);
}
console.log(`no-whole-suite-runs selftest: ${TABLE.length} rows ok`);
