// The shared shape of a portability gate's exception ledger, and the two
// KINDS of entry that shape has to tell apart.
//
// WHY THIS EXISTS. The copy, vocabulary and literal-copy gates all ratchet the
// same way: a map of finding -> written reason, shrink-only in both directions
// (a new finding fails, a fixed one left listed fails as stale). That is right
// for DEBT — a leak that predates the gate and is waiting for its package's
// adoption wave. It is wrong for the handful of findings that are correct and
// always will be.
//
// `packages/payments/backend/src/providers/pagbank-vault.ts` says
// "PagBank connection carries no public key (Chave pública)". The only
// Portuguese is the vendor's own dashboard field name, quoted so an owner can
// find the box — exactly as one would write "Secret key (sk_...)" for Stripe.
// Translating it sends someone hunting for a field that does not exist. The
// two `homologacao-*` files are the same: Pipefy form OPTION values and
// PagBank's service names, where a translated string is a rejected submission.
//
// Left undistinguished, those five sit in a burn-down list that can never
// reach zero, so the list reads as unfinished work for ever and the next
// reader re-litigates them. Splitting the kinds lets the gate say the true
// thing: the burn-down is DONE, and five vendor exemptions are argued.
//
// THE SHAPE THAT KEEPS THIS HONEST is `.payments-surface.json`'s, which had
// this problem first and solved it: `debt` may only shrink, `app-specific`
// needs a written argument, and BOTH counts are printed every run. That last
// part is what stops the escape hatch — relabelling debt as exempt does not
// make a number disappear, it moves it, visibly, in one line of output.
//
//   "path/to/file.ts": {
//     "kind": "exempt",             // argued, permanent
//     "why": "…the actual argument, not a label…"
//   }
//
// A bare string value still parses, as `grandfathered` with that string as its
// reason — so a ledger migrates when someone has a reason to touch it, not in
// one sweep across three files.

/** Entry kinds, in the order the summary line reports them. */
export const KINDS = ["grandfathered", "exempt"];

/** Boilerplate that is a label rather than an argument. */
const NOT_AN_ARGUMENT = /^\s*(exempt|permanent|vendor|n\/?a|todo|wontfix|by design)\s*\.?\s*$/i;

/** The shortest `why` an exemption can get away with. */
const MIN_WHY = 40;

/**
 * Normalize one raw ledger value into `{ kind, why }`.
 *
 * A string is `grandfathered` — that is what every entry was before this
 * module, and re-tagging them all at once would bury the five that matter.
 */
export function classifyEntry(value) {
  if (typeof value === "string") return { kind: "grandfathered", why: value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const kind = KINDS.includes(value.kind) ? value.kind : null;
    return { kind, why: typeof value.why === "string" ? value.why : "" };
  }
  return { kind: null, why: "" };
}

/** Read a ledger file into a Map of finding -> `{ kind, why }`. */
export function readLedger(path, { existsSync, readFileSync }) {
  if (!existsSync(path)) return new Map();
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return new Map(Object.entries(raw).map(([k, v]) => [k, classifyEntry(v)]));
}

/**
 * Hold `findings` against `ledger`, returning the failures and the per-kind
 * counts the caller prints.
 *
 * Four rules, and only the first differs by kind:
 *
 *  - an UNLISTED finding fails. Always — this is the gate.
 *  - a listed finding whose kind is unreadable fails, naming the two legal
 *    kinds. A typo must not silently widen the gate.
 *  - an `exempt` entry with no real argument fails. The whole difference
 *    between an exemption and a shrug is that somebody wrote down why.
 *  - a STALE entry fails whatever its kind: an exemption for a file that no
 *    longer leaks is as misleading as stale debt, and `exempt` must not
 *    become the place entries go to stop being checked.
 *
 * Note what is deliberately NOT here: a cap on `exempt`. `.payments-surface.json`
 * does not cap `app-specific` either. The control is the written argument plus
 * the printed count, not a number someone would eventually raise.
 */
export function checkLedger({ findings, ledger, label, ledgerPath, unlisted }) {
  const failures = [];
  const counts = { grandfathered: 0, exempt: 0 };

  for (const finding of findings) {
    if (!ledger.has(finding)) failures.push(unlisted(finding));
  }

  for (const [finding, { kind, why }] of ledger) {
    if (!findings.has(finding)) {
      failures.push(
        `stale exception: ${finding} is no longer a finding (fixed, moved or renamed) — ` +
          `delete its entry from ${ledgerPath}`,
      );
      continue;
    }
    if (kind === null) {
      failures.push(
        `${finding}: entry needs a "kind" of ${KINDS.map((k) => `"${k}"`).join(" or ")} in ${ledgerPath} ` +
          `("grandfathered" = debt awaiting its adoption wave, "exempt" = argued and permanent)`,
      );
      continue;
    }
    if (kind === "exempt" && (why.trim().length < MIN_WHY || NOT_AN_ARGUMENT.test(why))) {
      failures.push(
        `${finding}: an "exempt" entry needs a written argument in its "why" — say what would ` +
          `break if this were changed, not that it is exempt`,
      );
      continue;
    }
    counts[kind] += 1;
  }

  return { failures, counts };
}

/**
 * The summary line. Both counts always, so a relabel shows up as one number
 * falling and the other rising rather than as work disappearing.
 */
export function summarize({ label, total, noun, counts, burndown }) {
  const parts = [`${counts.grandfathered} grandfathered`, `${counts.exempt} exempt`];
  const tail =
    counts.grandfathered === 0
      ? "burn-down complete; the exemptions are argued in the ledger"
      : `shrink-only; ${burndown}`;
  return `${label} clean — ${total} ${noun}, ${parts.join(" + ")} (${tail}).`;
}
