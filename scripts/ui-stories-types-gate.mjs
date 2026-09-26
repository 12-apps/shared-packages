// The ui-stories-types gate: type-checks every `@12-apps/ui` story on its own
// project, `packages/ui/tsconfig.stories.json` (FUT-2699).
//
// ## Why
//
// `packages/ui/tsconfig.json` excludes `**/*.stories.tsx`, and that is the
// only project `check-types` / `typecheck` read (`packages/ui/package.json`'s
// `check-types` script runs it plus the two native configs — none of which
// include a story either). Storybook itself compiles stories with esbuild,
// which strips types without checking them. So nothing has ever type-checked
// a story: whole classes of bug — a missing required prop in a story that is
// not `args`-only, a `ReferenceError` from a name that was never in scope —
// were type errors all along, caught only if the story happened to run and
// throw. Measured at this gate's introduction: 125 files, ~1,356 errors.
//
// ## What runs
//
//   tsc -p packages/ui/tsconfig.stories.json --pretty false
//
// `tsconfig.stories.json` extends the package's own `tsconfig.json` (the same
// `strict`, the same path aliases, the same `types`), so a story is judged by
// the same rules as the component it renders — just widened to `include` the
// stories that project excludes, and `noEmit` since a story never ships. See
// that file's own header for why it is not simply folded into `tsconfig.json`.
//
// ## THE RATCHET — `.ui-stories-types-exceptions.json`, evaluated PURELY by
// `scripts/lib/ui-stories-types-evaluate.mjs` (read that file for the rules;
// this one is only the I/O around it: run tsc, read git, read/write the
// ledger). One entry per FILE (not per line — line numbers move on every
// edit and would churn the ledger for nothing), keying the file's CURRENT
// error count into the string, `"<file> ×<count>"`, so any change to that
// count — up OR down — makes the old key stop matching and the gate asks for
// `--update`. That is what turns "I fixed three errors" into a ledger change
// in the same PR, instead of a count silently drifting out of date.
//
//   - a file with errors that is not on the ledger fails — new debt, or debt
//     whose count moved without `--update`;
//   - a listed file whose error count is now zero fails as STALE — delete the
//     entry, the file is clean;
//   - a listed file whose count would need to RISE above what `origin/main`
//     already lists fails outright: the ledger only shrinks. A PR that edits
//     this gate or `tsconfig.stories.json` itself is the one exception — the
//     MEASURE moved, not the code — and is let through with a note.
//
// `--update` rewrites the ledger from the tree, refusing to write a count
// above what `origin/main` allows, and keeping each entry's existing reason.
//
// Order of payment (see the ticket): the 63 `*.test.stories.tsx` files come
// first, since their play functions are what CI actually runs; the 62 docs
// stories can stay grandfathered longer.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { readLedger } from "./lib/exception-ledger.mjs";
import { collectFindings, TSCONFIG } from "./lib/ui-stories-types-collect.mjs";
import { evaluate, findingOf, LEDGER_PATH, parseFinding, summarize } from "./lib/ui-stories-types-evaluate.mjs";

export { collectFindings, parseErrors, runTsc, TSCONFIG } from "./lib/ui-stories-types-collect.mjs";
export { evaluate, findingOf, LEDGER_PATH, parseFinding } from "./lib/ui-stories-types-evaluate.mjs";

const LABEL = "[ui-stories-types]";
const SCANNER_FILES = [
  "packages/ui/tsconfig.stories.json", "packages/ui/tsconfig.json",
  "scripts/ui-stories-types-gate.mjs", "scripts/lib/ui-stories-types-collect.mjs",
  "scripts/lib/ui-stories-types-evaluate.mjs",
];
const DEFAULT_REASON = "grandfathered: pre-existing type error in a story that predates the stories type-check lane (FUT-2699)";

const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const tryGit = (args) => { try { return git(args); } catch { return null; } };
const hasMain = () => tryGit(["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]) !== null;

/**
 * `origin/main`'s ledger as file -> count: `{ counts }`, `{ firstRun: true }`
 * when main has none yet (this gate's own introduction), `{ unreachable: true }`
 * when main cannot be read at all — which must not read as "first run", or a
 * failed fetch would switch the ratchet off.
 */
function readBase() {
  // CI checks out one commit; fetch main's tip so the ratchet has something to hold against.
  if (!hasMain()) tryGit(["fetch", "--no-tags", "--depth=1", "origin", "main:refs/remotes/origin/main"]);
  if (!hasMain()) return { unreachable: true };
  const raw = tryGit(["show", `origin/main:${LEDGER_PATH}`]);
  if (raw === null) return { firstRun: true };
  const counts = new Map(Object.keys(JSON.parse(raw)).map(parseFinding).filter(Boolean).map((p) => [p.file, p.count]));
  return { counts };
}

/** Did this branch change the project or the gate itself? Then a count may rise: the measure moved, not the code. */
const scannerChanged = () => tryGit(["diff", "--quiet", "origin/main", "--", ...SCANNER_FILES]) === null;

function readRawLedger() {
  return existsSync(LEDGER_PATH) ? JSON.parse(readFileSync(LEDGER_PATH, "utf8")) : {};
}

function update(counts) {
  const baseline = readBase();
  const previous = readRawLedger();
  const grew = baseline.counts && !scannerChanged()
    ? [...counts].filter(([file, n]) => n > (baseline.counts.get(file) ?? 0))
    : [];
  if (grew.length > 0) {
    console.error(`${LABEL} --update refuses to raise a count above origin/main:\n` +
      grew.map(([file, n]) => `  ${file}: ${n} errors, origin/main allows ${baseline.counts.get(file) ?? 0}`).join("\n"));
    process.exit(1);
  }
  const reasons = new Map(Object.entries(previous).map(([f, v]) => [parseFinding(f)?.file, v]));
  const next = Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))
    .map(([file, n]) => [findingOf(file, n), reasons.get(file) ?? DEFAULT_REASON]));
  writeFileSync(LEDGER_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${LABEL} wrote ${LEDGER_PATH}: ${counts.size} files, ${[...counts.values()].reduce((a, b) => a + b, 0)} errors.`);
}

function check(counts, detail) {
  const ledger = readLedger(LEDGER_PATH, { existsSync, readFileSync });
  const { failures, note, counts: kinds, total, files } = evaluate({
    counts, detail, ledger, base: readBase(), scannerChanged,
  });
  if (note) console.log(`${LABEL} note: ${note}`);
  if (failures.length > 0) {
    console.error(`${LABEL} ${failures.length} failure(s):\n\n${failures.map((f) => `  - ${f}`).join("\n\n")}`);
    process.exit(1);
  }
  console.log(`${LABEL} ${summarize({ total, files, counts: kinds })}`);
}

function main() {
  const { counts, detail, configErrors } = collectFindings(process.cwd());
  if (configErrors.length > 0) {
    console.error(`${LABEL} tsc reported ${configErrors.length} error(s) outside any story — the project itself ` +
      `(${TSCONFIG}) is broken, not a story:\n\n${configErrors.map((e) => `  - ${e}`).join("\n")}`);
    process.exit(1);
  }
  if (process.argv.includes("--update")) update(counts);
  else check(counts, detail);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
