// The ui-tokens gate: every size and colour a `@12-apps/ui` component draws is
// RELATIVE to the theme, so that a density mode is one decision in the theme
// instead of a hunt through 123 components (FUT-2585).
//
// ## Why a gate, and why now
//
// The audit that opened FUT-2585 read the package component by component and
// found 104 of 123 drawing with raw values: 1,269 `NNpx` literals, 246
// hand-typed `rem` literals, 223 hex/rgba colours, and 24 reads of
// `theme.typography`. None of them was a decision anybody made — each was the
// fastest way to get one screen right, and nothing said no. Review had said no
// to single instances for months (FUT-1924, FUT-2558, FUT-2569 are each one
// line), and the count still grew. A class that review cannot hold is a class a
// script has to.
//
// ## WHAT IS FLAGGED — `scripts/lib/ui-tokens-scan.mjs` (the key vocabulary is
// `ui-tokens-keys.mjs`, file discovery and the program `ui-tokens-collect.mjs`)
//
//   raw-color          `#fff`, `rgb[a](…)`, `hsl[a](…)`, a named colour on a
//                      colour key, a hex alpha glued onto a palette value.
//   palette-ramp       `palette.grey[…]` / `palette.common.*` and `sx`'s
//                      `'grey.100'` — a step on a ramp rather than a role.
//                      Legal in `src/tokens/`, where the roles are defined.
//   raw-font-size      any shape below on a FONT size, kept apart so the
//                      type-scale burn-down is countable on its own.
//   raw-length         `px`/`rem`/`pt` in a string or template, `${n}px`,
//                      `n + 'px'`. `0` is allowed, and `1px` only as a
//                      border/outline hairline. `${remPx(…)}px` and
//                      `${FIELD_BORDER_WIDTH}px` are allowed: some sinks
//                      (`IntersectionObserver.rootMargin`) only take px, and
//                      those two are already right in px.
//   raw-number-length  a non-zero number on a length key — including inside
//                      MUI's responsive `{ md: 168 }` / `[40, 60]` — and,
//                      TYPE-AWARE, a number-typed name on one
//                      (`maxWidth: DIALOG_MAX_WIDTH[size]`). In `sx`, spacing
//                      keys are units and `borderRadius` a shape multiple.
//   raw-jsx-size       `size={24}`, `width="20"`, `fontSize={16}` on an element
//                      (SVG shapes inside a viewBox and a grid's column `size`
//                      are not lengths).
//   px-helper          web code calling `px()` — it converts against a fixed
//                      16px and ignores the theme.
//   layout-constant    an UPPER_SNAKE length constant or a length-named
//                      parameter default holding a raw number.
//
// `*.metrics.ts` is scanned for colours only: its numbers are the native
// renderer's dp, and the type-aware rule checks where the web consumes them.
//
// ## THE RATCHET
//
// `.ui-tokens-exceptions.json`, one entry per `file — rule ×count`, read
// through `scripts/lib/exception-ledger.mjs`. An unlisted finding fails, a
// stale entry fails, and every count is held against the ledger on
// `origin/main`: a file may lose findings, never gain them. Two deliberate
// ways through: an `exempt` entry (an argued, permanent raw value — the whole
// `file — rule` bucket) is not held to main's count, and a PR that changes the
// SCANNER may raise counts, since what moved is the measure, not the code.
// When main cannot be read at all the gate fails rather than skipping its
// ratchet.
//
// `--update` rewrites the ledger from the tree, keeping each entry's reason.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { checkLedger, readLedger, summarize } from "./lib/exception-ledger.mjs";
import { collectFindings } from "./lib/ui-tokens-collect.mjs";

export { collectFindings, scopeFiles } from "./lib/ui-tokens-collect.mjs";
export { RULES, scanSource } from "./lib/ui-tokens-scan.mjs";

const LABEL = "[ui-tokens]";
export const LEDGER_PATH = ".ui-tokens-exceptions.json";
const SCANNER_FILES = [
  "scripts/ui-tokens-gate.mjs", "scripts/lib/ui-tokens-scan.mjs", "scripts/lib/ui-tokens-keys.mjs", "scripts/lib/ui-tokens-collect.mjs",
];
const DEFAULT_REASON = "grandfathered: raw value that predates the gate (FUT-2585)";

export const findingOf = (key, count) => `${key} ×${count}`;
export const parseFinding = (finding) => {
  const m = /^(.*) ×(\d+)$/.exec(finding);
  return m ? { key: m[1], count: Number(m[2]) } : null;
};

const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const tryGit = (args) => { try { return git(args); } catch { return null; } };
const hasMain = () => tryGit(["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]) !== null;

/**
 * main's ledger as key -> count: `{ counts }`, `{ firstRun: true }` when main
 * has none yet, `{ unreachable: true }` when main itself cannot be read — which
 * must not read as "first run", or a failed fetch would switch the ratchet off.
 */
function readBase() {
  // CI checks out one commit; fetch main's tip so the ratchet has something to hold against.
  if (!hasMain()) tryGit(["fetch", "--no-tags", "--depth=1", "origin", "main:refs/remotes/origin/main"]);
  if (!hasMain()) return { unreachable: true };
  const raw = tryGit(["show", `origin/main:${LEDGER_PATH}`]);
  if (raw === null) return { firstRun: true };
  const counts = new Map(Object.keys(JSON.parse(raw)).map(parseFinding).filter(Boolean).map((p) => [p.key, p.count]));
  return { counts };
}

/** Did this branch change the scanner itself? Then a count may rise: the measure moved, not the code. */
const scannerChanged = () => tryGit(["diff", "--quiet", "origin/main", "--", ...SCANNER_FILES]) === null;

function readRawLedger() {
  return existsSync(LEDGER_PATH) ? JSON.parse(readFileSync(LEDGER_PATH, "utf8")) : {};
}

/** Keys whose ledger entry is an argued exemption — not held to main's count. */
function exemptKeys(ledger) {
  return new Set([...ledger].filter(([, e]) => e.kind === "exempt").map(([f]) => parseFinding(f)?.key));
}

function growthFailures(counts, base, exempt) {
  return [...counts]
    .filter(([key, n]) => !exempt.has(key) && n > (base.get(key) ?? 0))
    .map(([key, n]) => `${key}: ${n} findings, origin/main allows ${base.get(key) ?? 0} — the ledger only shrinks`);
}

function ratchetFailures(counts, baseline, exempt) {
  if (baseline.unreachable) {
    return [`origin/main could not be read (fetch failed?) — the shrink-only check cannot run, and a gate ` +
      `that silently skips its ratchet is not a gate. Fetch main (git fetch origin main) and re-run.`];
  }
  if (baseline.firstRun) {
    console.log(`${LABEL} note: no ${LEDGER_PATH} on origin/main to hold the counts against (first run).`);
    return [];
  }
  const grew = growthFailures(counts, baseline.counts, exempt);
  if (grew.length > 0 && scannerChanged()) {
    console.log(`${LABEL} note: the scanner changed on this branch, so ${grew.length} count(s) may rise:\n  ${grew.join("\n  ")}`);
    return [];
  }
  return grew;
}

function unlistedMessage(detail) {
  return (finding) => {
    const { key } = parseFinding(finding);
    const examples = (detail.get(key) ?? []).slice(0, 5).map((d) => `      ${d}`).join("\n");
    return `${finding} is not in ${LEDGER_PATH} — write the value through the theme (rem(theme, px) / sxRem / ` +
      `rem(theme, theme.breakpoints.values.x) / a palette role; see packages/ui/components-guidelines.md "Density"). ` +
      `An object meant for sx can be named \`…Sx\` or typed SxProps so its spacing units are recognised. ` +
      `If the count only FELL, run \`node scripts/ui-tokens-gate.mjs --update\`:\n${examples}`;
  };
}

function update(counts) {
  const baseline = readBase();
  const previous = readRawLedger();
  const exempt = exemptKeys(readLedger(LEDGER_PATH, { existsSync, readFileSync }));
  const grew = baseline.counts && !scannerChanged() ? growthFailures(counts, baseline.counts, exempt) : [];
  if (grew.length > 0) {
    console.error(`${LABEL} --update refuses to raise a count above origin/main:\n  ${grew.join("\n  ")}`);
    process.exit(1);
  }
  const reasons = new Map(Object.entries(previous).map(([f, v]) => [parseFinding(f)?.key, v]));
  const next = Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => [findingOf(k, n), reasons.get(k) ?? DEFAULT_REASON]));
  writeFileSync(LEDGER_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${LABEL} wrote ${LEDGER_PATH}: ${counts.size} entries, ${[...counts.values()].reduce((a, b) => a + b, 0)} findings.`);
}

function check(counts, detail) {
  const ledger = readLedger(LEDGER_PATH, { existsSync, readFileSync });
  const findings = new Set([...counts].map(([k, n]) => findingOf(k, n)));
  const { failures, counts: kinds } = checkLedger({
    findings, ledger, label: LABEL, ledgerPath: LEDGER_PATH, unlisted: unlistedMessage(detail),
  });
  failures.push(...ratchetFailures(counts, readBase(), exemptKeys(ledger)));
  if (failures.length > 0) {
    console.error(`${LABEL} ${failures.length} failure(s):\n\n${failures.map((f) => `  - ${f}`).join("\n\n")}`);
    process.exit(1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(summarize({
    label: LABEL, total, noun: "raw sizes/colours", counts: kinds,
    burndown: "each PR that converts a component deletes or lowers its entries",
  }));
}

function main() {
  const { counts, detail } = collectFindings(process.cwd());
  if (process.argv.includes("--update")) update(counts);
  else check(counts, detail);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
