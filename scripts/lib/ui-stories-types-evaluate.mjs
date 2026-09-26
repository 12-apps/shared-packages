// The PURE half of the ui-stories-types gate (FUT-2699): given this run's
// per-file error counts, the exception ledger and origin/main's copy of it,
// decide what fails. No tsc, no git, no filesystem — so
// `scripts/ui-stories-types-selftest.mjs` can hold every rule against
// fabricated counts instead of waiting on a real compile.
import { checkLedger } from "./exception-ledger.mjs";

export const LEDGER_PATH = ".ui-stories-types-exceptions.json";

/** The ledger keys a file's CURRENT count into the string, so any change unlists the old entry. */
export const findingOf = (file, count) => `${file} ×${count}`;
export const parseFinding = (finding) => {
  const m = /^(.*) ×(\d+)$/.exec(finding);
  return m ? { file: m[1], count: Number(m[2]) } : null;
};

/** Files whose count in `counts` exceeds what `base` (origin/main) allows. */
function growthFailures(counts, base) {
  return [...counts]
    .filter(([file, n]) => n > (base.get(file) ?? 0))
    .map(([file, n]) => `${file}: ${n} errors, origin/main allows ${base.get(file) ?? 0} — the ledger only shrinks`);
}

/**
 * Shrink-only against `origin/main`. `scannerChanged` is a thunk rather than a
 * plain boolean so the (real) git diff behind it runs only when a count has
 * actually grown — the common case never pays for it.
 */
function ratchetFailures(counts, base, scannerChanged) {
  if (base.unreachable) {
    return { failures: [`origin/main could not be read (fetch failed?) — the shrink-only check cannot run, and a gate ` +
      `that silently skips its ratchet is not a gate. Fetch main (git fetch origin main) and re-run.`] };
  }
  if (base.firstRun) return { failures: [], note: "no ledger on origin/main to hold the counts against (first run)." };
  const grew = growthFailures(counts, base.counts);
  if (grew.length > 0 && scannerChanged()) {
    return { failures: [], note: `tsconfig.stories.json or the gate changed on this branch, so ${grew.length} count(s) may rise:\n  ${grew.join("\n  ")}` };
  }
  return { failures: grew };
}

function unlistedMessage(detail) {
  return (finding) => {
    const { file } = parseFinding(finding);
    const examples = (detail.get(file) ?? []).map((d) => `      ${d}`).join("\n");
    return `${finding} is not in ${LEDGER_PATH} — fix the story's types, or, if the count only FELL, run ` +
      `\`node scripts/ui-stories-types-gate.mjs --update\`:\n${examples}`;
  };
}

/**
 * The whole decision. `counts` is file -> error count for this run, `detail`
 * is file -> a few example messages, `ledger` is `readLedger`'s Map, `base` is
 * `{ counts: Map }`, `{ firstRun: true }` or `{ unreachable: true }`, and
 * `scannerChanged` is a zero-arg thunk answering whether this branch touched
 * the project or the gate itself (real callers pass a `git diff` check; the
 * selftest passes `() => false` or `() => true` directly).
 */
export function evaluate({ counts, detail, ledger, base, scannerChanged }) {
  const findings = new Set([...counts].map(([file, n]) => findingOf(file, n)));
  const listed = checkLedger({ findings, ledger, ledgerPath: LEDGER_PATH, unlisted: unlistedMessage(detail) });
  const ratchet = ratchetFailures(counts, base, scannerChanged);
  const failures = [...listed.failures, ...(ratchet.failures ?? [])];
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return { failures, note: ratchet.note, counts: listed.counts, total, files: counts.size };
}

export function summarize({ total, files, counts }) {
  const parts = [`${counts.grandfathered} grandfathered`, `${counts.exempt} exempt`];
  const tail = counts.grandfathered === 0
    ? "burn-down complete; the exemptions are argued in the ledger"
    : "shrink-only; each PR that fixes a story's types lowers or deletes its entry";
  return `clean — ${total} errors across ${files} files, ${parts.join(" + ")} (${tail}).`;
}
