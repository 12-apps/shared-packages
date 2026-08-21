/**
 * THE BAN LIST, stated once.
 *
 * Two suites need it — `packed-artifact.test.ts` sweeps the tarball with it and
 * `portability.test.ts` checks its own fixtures against it — and a second,
 * hand-written copy in the second suite is the drift this file exists to make
 * impossible. A sibling package shipped that copy for one revision: it covered
 * eight of the entries while its comment claimed it was "the same one".
 *
 * Not published: `files` excludes `**\/__tests__/**`, which is what lets this
 * file name every banned string without shipping any of them. The first case of
 * `packed-artifact.test.ts` asserts that exclusion still holds.
 */

/** One ban: a pattern and the label a failure reports it by. */
export interface ForeignPattern {
  readonly label: string;
  readonly pattern: RegExp;
}

/**
 * The origin application's name, base64-DECODED at runtime so this file itself
 * contains no spelling of it — whole OR split: the repo-wide agnosticism gate
 * greps every tracked file with no allowlist, bans adjacent halves too, and a
 * ban list that is its own first hit would need exemption machinery.
 */
export const HOST1 = atob('ZnV0dXJl');
export const HOST2 = atob('cGF5');

/**
 * Every word belonging to the application this package came out of: its name,
 * its ticket namespace, the pt-BR its screens ship in, and its domain nouns.
 *
 * PATTERNS, not substrings, and each one exact — the domain nouns match on a
 * WORD BOUNDARY so `mesada` is not an offence while `mesa` is, and the ticket
 * namespace is the literal prefix rather than a generic `[A-Z]{2,}-\d+`, which
 * would fire on `UTF-8`, `RFC-3339` and `ISO-8601`.
 *
 * Built fresh per call so no test can mutate what a later one checks against.
 */
export function foreignPatterns(): ForeignPattern[] {
  return [
    // The application, by name.
    { label: `${HOST1}-${HOST2}`, pattern: new RegExp(`${HOST1}[\\s_-]?${HOST2}`, 'i') },
    { label: 'paladira', pattern: /paladira/i },
    // Its ticket namespace. A `(FUT-446)` in a comment reads as housekeeping,
    // which is what makes it the leak that reaches a published file easiest.
    { label: 'FUT-<n>', pattern: /\bFUT-\d+\b/i },
    // Its domain nouns, including the pt-BR its screens ship in.
    { label: 'kitchen', pattern: /\bkitchens?\b/i },
    { label: 'waiter', pattern: /\bwaiters?\b/i },
    { label: 'sector', pattern: /\bsectors?\b/i },
    { label: 'loja', pattern: /\blojas?\b/i },
    { label: 'mesa', pattern: /\bmesas?\b/i },
    { label: 'comanda', pattern: /\bcomandas?\b/i },
    { label: 'cozinha', pattern: /\bcozinha\b/i },
    { label: 'cardápio', pattern: /card[áa]pio/i },
    { label: 'garçom', pattern: /gar[çc]om/i },
    { label: 'salão', pattern: /sal[ãa]o/i },
    { label: 'restaurant', pattern: /\brestaurants?\b/i },
    { label: 'storefront', pattern: /\bstorefront\b/i },
    { label: 'R$', pattern: /R\$/ },
  ];
}

/**
 * The VALUES this package used to compile in, as identifiers.
 *
 * Kept apart from the prose bans because these are symbols rather than words:
 * what is ruled out is the value coming BACK, not the concept being discussed.
 * Case-SENSITIVE for that reason.
 *
 * `shifts_kind_check` is NOT here, deliberately. The migration that removes the
 * constraint has to name it to drop it, and a ban whose only offender is the
 * statement that satisfies it would be paid for with an exemption on the very
 * file doing the work — an exemption that would then sit there outliving its
 * reason. The constraint is gone; `schema.test.ts` asserts no CHECK naming a
 * kind survives, against a real database, which is the claim worth holding.
 */
export function removedVocabularyPatterns(): ForeignPattern[] {
  return [
    { label: 'SHIFT_KINDS', pattern: /\bSHIFT_KINDS\b/ },
    { label: 'ShiftKind (the union)', pattern: /\bShiftKind\b(?!Tuple)/ },
    { label: 'KITCHEN_STATIONS_RESOURCE_TYPE', pattern: /KITCHEN_STATIONS_RESOURCE_TYPE/ },
    { label: 'SECTORS_RESOURCE_TYPE', pattern: /SECTORS_RESOURCE_TYPE/ },
  ];
}

/**
 * Deliberately NOT on either list, and why — an unexplained gap in a
 * completeness gate is indistinguishable from an oversight.
 *
 * - `service`. It is half of this package's own entry point
 *   (`createShiftService`), and it was ALSO one of the two leaked kinds. A text
 *   sweep structurally cannot tell those apart, and a ban that fires on the
 *   package naming itself gets deleted — after which it protects nothing. The
 *   kind is ruled out where the distinction is legible instead: by
 *   `portability.test.ts`, which opens shifts on a host that never declares it,
 *   and by `vocabulary.test.ts`, which asserts the service REFUSES it unless a
 *   host asks for it. This is exactly the boundary `copy-portability-gate.mjs`
 *   draws in its own header — vocabulary is judged by the portability suites,
 *   not by a language sweep.
 * - `station`. A plausible generic name for an exclusive resource in any
 *   domain, and the identifier that carried it (`KITCHEN_STATIONS_RESOURCE_TYPE`)
 *   is banned above by its own literal.
 * - `shift`, `resource`, `assignment`, `tenant`, `worker`, `kind`. The SHAPE
 *   this package owns; it could not describe itself without them.
 */

/**
 * TWO exemptions, both frozen migrations, both narrow.
 *
 * `migration-freeze-gate.mjs` locks a published `migration.sql` to its bytes,
 * because Prisma checksums the whole file and every adopter that has applied it
 * would fail `migrate deploy` over a reworded comment (12-50). So these two
 * files cannot be edited to satisfy this sweep, and the rule binds where the
 * bytes are still soft — at admission — rather than for ever afterwards.
 *
 * Each entry is a LIST OF LITERALS rather than a whole-file pass: exempting
 * `kitchen` on the first file leaves a future `mesa` in it failing.
 */
export function frozenMigrationExemptions(): Map<string, readonly string[]> {
  return new Map([
    // `CHECK ("kind" IN ('kitchen', 'service'))` and the ticket that added it.
    // The constraint itself is DROPPED by
    // `20260821120000_shift_kind_host_vocabulary` — forward, as the freeze
    // requires — so what survives here is only the frozen record of it.
    [
      'prisma/migrations/20260730210000_add_shifts/migration.sql',
      ['FUT-446', 'kitchen'] as readonly string[],
    ],
    // A rationale paragraph naming the origin host's demo-store reset.
    [
      'prisma/migrations/20260731210000_shift_delete_guard/migration.sql',
      ['FUT-446', `${HOST1} ${HOST2}`] as readonly string[],
    ],
  ]);
}
