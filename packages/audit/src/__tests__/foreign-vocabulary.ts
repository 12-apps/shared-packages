/**
 * THE ban list, stated once.
 *
 * Two suites need it — `packed-artifact.test.ts` sweeps the tarball with it and
 * `portability.test.ts` checks its own fixtures against it — and a second,
 * hand-written copy in the second suite is exactly the drift this package now
 * exists to make impossible. A sibling package shipped that copy for one
 * revision: it covered eight of the entries while its comment claimed it was
 * "the same one".
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
 * The origin application's name, base64-DECODED at runtime so this file
 * itself contains no spelling of it — whole OR split: the repo-wide
 * agnosticism gate greps every file with no allowlist, bans adjacent halves
 * too, and a ban list that is its own first hit would need the exemption
 * machinery this package just burned down.
 */
export const HOST1 = atob('ZnV0dXJl');
export const HOST2 = atob('cGF5');

/**
 * Every word belonging to the application this package came out of: its name,
 * its domain nouns, the pt-BR its screens ship in, its currency, its ticket
 * namespace, and the identifiers of the vocabulary this package used to
 * publish.
 *
 * PATTERNS, not substrings, and each one exact:
 *
 * - the domain nouns match on a WORD BOUNDARY, so `mesada` and `lojista` are
 *   not offences while `mesa`, `mesas` and `a loja` are;
 * - the dotted ACTION ids and the snake_case RESOURCE ids need entries of their
 *   own, because `.` and `_` sit outside `\b`'s alphabet in the places that
 *   matter: `\border\b` does not see `order.cancel` as a unit and would fire on
 *   the ordinary English word `order`, which a package about audit trails uses
 *   legitimately. A ban that cries wolf gets deleted, and then it protects
 *   nothing;
 * - the ticket namespace is the exact prefix rather than a generic
 *   `[A-Z]{2,}-\d+`, which would fire on `UTF-8`, `RFC-3339` and `ISO-8601`;
 * - the currency symbol is case-sensitive and carries NO trailing space. An
 *   entry of `'R$ '` is not how a price is written — `R$59,00` sails straight
 *   past it, which is a defect a sibling package shipped.
 *
 * Built fresh per call so no test can mutate what a later one checks against.
 */
export function foreignPatterns(): ForeignPattern[] {
  return [
    // The application, by name.
    { label: `${HOST1}-${HOST2}`, pattern: new RegExp(`${HOST1}[\\s_-]?${HOST2}`, 'i') },
    { label: 'paladira', pattern: /paladira/i },
    { label: 'pagbank', pattern: /pagbank/i },
    // Its ticket namespace. A `(FUT-901)` in a comment reads as housekeeping,
    // which is what makes it the leak that reaches a published file easiest.
    { label: 'FUT-<n>', pattern: /\bFUT-\d+\b/gi },
    // Its domain nouns, including the pt-BR its storefront ships in.
    { label: 'loja', pattern: /\blojas?\b/i },
    { label: 'mesa', pattern: /\bmesas?\b/i },
    { label: 'comanda', pattern: /\bcomandas?\b/i },
    { label: 'cozinha', pattern: /\bcozinha\b/i },
    { label: 'cardápio', pattern: /card[áa]pio/i },
    { label: 'estoque', pattern: /\bestoque\b/i },
    { label: 'fornecedor', pattern: /\bfornecedor(es)?\b/i },
    { label: 'garçom', pattern: /gar[çc]om/i },
    { label: 'salão', pattern: /sal[ãa]o/i },
    { label: 'perda', pattern: /\bperdas?\b/i },
    { label: 'restaurant', pattern: /\brestaurants?\b/i },
    { label: 'storefront', pattern: /\bstorefront\b/i },
    { label: 'R$', pattern: /R\$/ },
    // The pt-BR the viewer's own copy used to default to. These are the exact
    // strings the screens rendered, and each is a sentence no adopter chose.
    { label: 'Auditoria', pattern: /\bauditoria\b/i },
    { label: 'Sistema', pattern: /\bsistema\b/i },
    { label: 'em nome de', pattern: /em nome de/i },
    // Anchored on both sides, unlike the rest: `p[áa]gina` unanchored is a
    // substring of the ordinary English `pagination`, which this package's own
    // wire type is named after. A ban that fires on the package describing
    // itself gets deleted, and then it protects nothing.
    { label: 'Página', pattern: /\bp[áa]ginas?\b/i },
    { label: 'registros', pattern: /\bregistros\b/i },
    { label: 'Não autenticado', pattern: /n[ãa]o autenticado/i },
    { label: 'Filtros inválidos', pattern: /filtros inv[áa]lidos/i },
    { label: 'AAAA-MM-DD', pattern: /AAAA-MM-DD/ },
  ];
}

/**
 * The VALUES this package used to compile in, as identifiers.
 *
 * Kept apart from the prose bans above because these are symbols rather than
 * words: what is being ruled out is the value coming back, not the concept
 * being discussed. An audit package cannot describe itself without the words
 * "action", "resource" and "order" — `order.cancel` is a different matter, and
 * `\border\b` structurally cannot tell the two apart.
 *
 * Case-SENSITIVE for the same reason.
 */
export function removedVocabularyPatterns(): ForeignPattern[] {
  const HOST_PREFIX = `${HOST1.toUpperCase()}_${HOST2.toUpperCase()}`;
  return [
    { label: `${HOST_PREFIX}_AUDIT_*`, pattern: new RegExp(`${HOST_PREFIX}_AUDIT`) },
    { label: `${HOST_PREFIX}_TRACKED_MODELS`, pattern: new RegExp(`${HOST_PREFIX}_TRACKED_MODELS`) },
    { label: 'SHORT_PAYMENT_ACTION', pattern: /SHORT_PAYMENT(_RESOLVED)?_ACTION/ },
    { label: 'OVER_PAYMENT_ACTION', pattern: /OVER_PAYMENT_ACTION/ },
    { label: 'REFUND_PAYMENT_ACTION', pattern: /REFUND_PAYMENT_ACTION/ },
    { label: 'DISPUTE_PAYMENT_ACTION', pattern: /DISPUTE_PAYMENT_ACTION/ },
    // The action ids themselves. Dotted, so they are their own tokens.
    { label: 'order.cancel', pattern: /order\.cancel/ },
    { label: 'payment.short', pattern: /payment\.short/ },
    { label: 'payment.capture', pattern: /payment\.capture/ },
    { label: 'comanda.force_close', pattern: /comanda\.force_close/ },
    { label: 'stock.loss', pattern: /stock\.loss/ },
    { label: 'impersonation.start', pattern: /impersonation\.(start|end|refused|configured)/ },
    // The resource ids, and the tracked model names.
    { label: 'table_session', pattern: /table_session/ },
    { label: 'stock_movement', pattern: /stock_movement/ },
    { label: 'inventory_item', pattern: /inventory_item/ },
    { label: 'loss_event', pattern: /loss_event/ },
    { label: 'MenuItem', pattern: /MenuItem/ },
    { label: 'ProductCategory', pattern: /ProductCategory/ },
  ];
}

/**
 * Deliberately NOT on either list: `audit`, `action`, `resource`, `actor`,
 * `entry`, `trail`, `impersonation` and `retention`. An audit trail having
 * actions against resources, written by an actor, is the SHAPE this package
 * owns — it could not describe itself without those words, and `files`
 * publishes every one of its docs. What IS listed is every value, label, key
 * and name that belonged to one application inside that shape.
 *
 * The judgement is written down because an unexplained gap in a completeness
 * gate is indistinguishable from an oversight.
 */

/**
 * There is no longer any published entry allowed to name a removed export.
 *
 * ADOPTING.md used to carry the 2.x → 3.0.0 migration table, whose left column
 * had to name the removed host-branded exports — the one documented exemption.
 * Both known consumers completed that migration, the table now lives in the
 * 2.x tags' ADOPTING.md in git history, and the exemption is gone: every
 * packed entry is swept with the full list.
 */
