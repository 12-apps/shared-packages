/**
 * THE ban list, stated once.
 *
 * Two suites need it — `packed-artifact.test.ts` sweeps the tarball with it and
 * `portability.test.ts` checks its own fixtures against it — and a second,
 * hand-written copy in the second suite is exactly the drift this package
 * exists to make impossible. It lived there for one revision and covered eight
 * of these entries while its comment claimed it was "the same one".
 *
 * Not published: `files` excludes `**\/__tests__/**`, which is what lets this
 * file name every banned string without shipping any of them.
 */

/** One ban: a pattern and the label a failure reports it by. */
export interface ForeignPattern {
  readonly label: string;
  readonly pattern: RegExp;
}

/**
 * Every word belonging to the application this package came out of: the two
 * value sets it used to compile in, the pt-BR labels those values carry on its
 * screens, its feature key, its table names and its own name.
 *
 * PATTERNS, not substrings, and each one exact:
 *
 * - the value words are matched on a WORD BOUNDARY, so `lossless` and `against`
 *   are not offences while `LOSS`, `a loss reason` and `loss-reasons` are;
 * - the identifiers with an UNDERSCORE need their own entries, because `_` is a
 *   word character: `\bloss\b` does not match `loss_tracking` or `loss_events`,
 *   which is exactly the kind of near-miss a ban list is written to catch and
 *   the reason a sibling package's currency entry once shipped a real value
 *   past itself on a trailing space;
 * - the currency symbol is case-sensitive and carries no space, for that same
 *   reason.
 *
 * Built fresh per call so no test can mutate what a later one checks against.
 */
export function foreignPatterns(): ForeignPattern[] {
  return [
    { label: 'LOSS', pattern: /\bloss(es)?\b/i },
    { label: 'GAIN', pattern: /\bgains?\b/i },
    { label: 'WASTE', pattern: /\bwaste\b/i },
    { label: 'SPOILAGE', pattern: /\bspoilage\b/i },
    { label: 'loss_tracking', pattern: /loss_tracking/i },
    { label: 'loss_reasons', pattern: /loss_reasons/i },
    { label: 'loss_events', pattern: /loss_events/i },
    { label: 'perda', pattern: /\bperdas?\b/i },
    { label: 'ganho', pattern: /\bganhos?\b/i },
    { label: 'desperdício', pattern: /desperd[íi]cio/i },
    { label: 'estrago', pattern: /\bestrago\b/i },
    { label: 'motivo', pattern: /\bmotivos?\b/i },
    { label: 'estoque', pattern: /\bestoque\b/i },
    { label: 'insumo', pattern: /\binsumos?\b/i },
    { label: 'fornecedor', pattern: /\bfornecedor(es)?\b/i },
    { label: 'loja', pattern: /\bloja\b/i },
    { label: 'mesa', pattern: /\bmesas?\b/i },
    { label: 'comanda', pattern: /\bcomandas?\b/i },
    { label: 'cozinha', pattern: /\bcozinha\b/i },
    { label: 'cardápio', pattern: /card[áa]pio/i },
    { label: 'salão', pattern: /sal[ãa]o/i },
    { label: 'garçom', pattern: /gar[çc]om/i },
    { label: 'R$', pattern: /R\$/ },
    { label: 'future-pay', pattern: /future[\s-]?pay/i },
    { label: 'paladira', pattern: /paladira/i },
    { label: 'pagbank', pattern: /pagbank/i },
  ];
}

/**
 * Deliberately NOT on the list above: `stock`, `movement`, `reason`,
 * `direction` and `inventory`. A stock ledger having movements with reasons on
 * a direction axis is a fact about stock ledgers — it is the shape this package
 * owns, and the package could not describe itself without those words. What IS
 * listed is every value, label and key that names one operation's choices
 * within that shape. The judgement is written down because an unexplained gap
 * in a completeness gate is indistinguishable from an oversight.
 */

/**
 * The eight exports this package DELETED, by name.
 *
 * Every one of them carries an `_` or a camel hump across the `loss` boundary,
 * so not a single one is visible to `\bloss\b` above — `LOSS_CATEGORIES`,
 * `DEFAULT_LOSS_CATEGORY`, `LossCategory` and `isLossCategory` all sail past
 * it. Without these four patterns a later change re-adding
 * `export type LossCategory` to `src/` ships green through the only
 * host-vocabulary gate this package has.
 *
 * Four patterns cover all eight names: `STOCK_REASON_KIND` is a prefix of
 * `STOCK_REASON_KINDS` and a suffix of `DEFAULT_STOCK_REASON_KIND`;
 * `LOSS_CATEGOR` covers `LOSS_CATEGORIES` and `DEFAULT_LOSS_CATEGORY`;
 * `StockReasonKind` and `LossCategory` each cover their type and their guard.
 *
 * Case-SENSITIVE, because these are identifiers rather than prose: the thing
 * being ruled out is the symbol coming back, not the words being discussed.
 */
export function removedExportPatterns(): ForeignPattern[] {
  return [
    { label: 'STOCK_REASON_KIND(S)', pattern: /STOCK_REASON_KIND/ },
    { label: 'LOSS_CATEGOR(IES|Y)', pattern: /LOSS_CATEGOR/ },
    { label: 'StockReasonKind', pattern: /StockReasonKind/ },
    { label: 'LossCategory', pattern: /LossCategory/ },
  ];
}

/**
 * The ONE published entry allowed to name a removed export.
 *
 * A migration table whose left column cannot say what was removed is not a
 * migration table. The exemption is a single exact path, never a directory and
 * never the pattern being switched off elsewhere — and
 * `packed-artifact.test.ts` proves the scoping in BOTH directions: that the
 * file really does still contain those names (so the exemption is load-bearing
 * rather than quietly dead), and that no other packed entry does.
 */
export const REMOVED_EXPORTS_ALLOWED_IN = 'ADOPTING.md';
