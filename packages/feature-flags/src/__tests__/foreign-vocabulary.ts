/**
 * THE ban list, stated once — the audit package's arrangement, adopted here
 * after this package proved the case for it on its first day: the 1.x screen
 * defaulted to one application's language and its routes compiled that
 * application's denial sentences in, and nothing failed. Two suites consume
 * this file — `packed-artifact.test.ts` sweeps the published tarball with it
 * and `portability.test.ts` checks its own fixtures against it — and a second
 * hand-written copy in either is exactly the drift the shared file prevents.
 *
 * Not published: `files` excludes `**\/__tests__/**`, which is what lets this
 * file name every banned string without shipping any of them. The first case
 * of `packed-artifact.test.ts` asserts that exclusion still holds.
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
 * too, and a ban list that is its own first hit would need exemption
 * machinery nobody wants back.
 */
export const HOST1 = atob("ZnV0dXJl");
export const HOST2 = atob("cGF5");

/**
 * Words belonging to the application this package was extracted for: its
 * name, its payment provider, its ticket namespace, its storefront's domain
 * nouns and its currency.
 *
 * PATTERNS, not substrings, and each one exact (the audit list's discipline):
 * domain nouns match on a word boundary so `mesada` and `lojista` are not
 * offences while `mesa` and `a loja` are; the ticket namespace is the exact
 * prefix rather than a generic `[A-Z]+-\d+`, which would fire on `UTF-8` and
 * `ISO-8601`; the currency symbol is case-sensitive with NO trailing space,
 * because `R$59,00` is how a price is actually written.
 *
 * Built fresh per call so no test can mutate what a later one checks against.
 */
export function foreignPatterns(): ForeignPattern[] {
  return [
    { label: `${HOST1}-${HOST2}`, pattern: new RegExp(`${HOST1}[\\s_-]?${HOST2}`, "i") },
    { label: "paladira", pattern: /paladira/i },
    { label: "pagbank", pattern: /pagbank/i },
    // A `(FUT-901)` in a comment reads as housekeeping, which is what makes
    // it the leak that reaches a published file easiest — this package
    // shipped several in its own docstrings before this list existed.
    { label: "FUT-<n>", pattern: /\bFUT-\d+\b/gi },
    { label: "loja", pattern: /\blojas?\b/i },
    { label: "mesa", pattern: /\bmesas?\b/i },
    { label: "comanda", pattern: /\bcomandas?\b/i },
    { label: "cozinha", pattern: /\bcozinha\b/i },
    { label: "cardápio", pattern: /card[áa]pio/i },
    { label: "entrega", pattern: /\bentregas?\b/i },
    { label: "storefront", pattern: /\bstorefront\b/i },
    { label: "R$", pattern: /R\$/ },
  ];
}

/**
 * The pt-BR this package's own 1.x compiled in — the exact copy defaults the
 * screen rendered and the denial sentences the routes answered with. Kept
 * apart from the origin-domain list above because these are the REMOVED
 * surface: what is being ruled out is the old language coming back as a
 * default, in any file the tarball ships.
 *
 * Anchoring caveat: JS `\b` is ASCII, so a pattern may not BEGIN or END on an
 * accented character's boundary (`órfã` is left unanchored; `p[áa]ginas?` is
 * safe because both ends are plain letters). `p[áa]ginas?` is anchored on
 * both sides precisely so the package's own English — `pagination`,
 * `paginator` — never trips it: a ban that cries wolf gets deleted, and then
 * it protects nothing.
 */
export function removedCopyPatterns(): ForeignPattern[] {
  return [
    { label: "usuário", pattern: /usu[áa]rios?/i },
    { label: "recurso", pattern: /\brecursos?\b/i },
    { label: "concessão", pattern: /concess[õã]/i },
    { label: "conceder", pattern: /\bconce(da|der|dido|dendo)\b/i },
    { label: "observação", pattern: /observa[çc][ãa]o/i },
    { label: "revogar", pattern: /\brevog/i },
    { label: "ativar/ativo", pattern: /\bativ(ar|os?)\b/i },
    { label: "desativar", pattern: /\bdesativ/i },
    { label: "não autenticado", pattern: /n[ãa]o autenticado/i },
    { label: "não foi possível", pattern: /n[ãa]o foi poss[íi]vel/i },
    { label: "e-mail válido", pattern: /e-?mail v[áa]lido/i },
    { label: "inválido", pattern: /inv[áa]lidos?\b/i },
    { label: "booleano", pattern: /booleano/i },
    { label: "Página", pattern: /\bp[áa]ginas?\b/i },
    { label: "órfã", pattern: /[óo]rf[ãa]s?/i },
    { label: "situação", pattern: /situa[çc][ãa]o/i },
    { label: "ações", pattern: /\ba[çc][õo]es\b/i },
    { label: "anterior", pattern: /\banterior\b/i },
    { label: "próxima", pattern: /\bpr[óo]ximas?\b/i },
    { label: "testador", pattern: /\btestador(a|as|es)?\b/i },
    { label: "catálogo", pattern: /cat[áa]logo/i },
  ];
}

/**
 * Deliberately NOT on either list: `flag`, `grant`, `beta`, `cohort`,
 * `catalog`, `orphan`, `enabled`, `veil`, `pagination`. A flags package
 * enrolling people into betas is the SHAPE this package owns — it could not
 * describe itself without those words, and `files` publishes every one of its
 * docs. What IS listed is every value, sentence and name that belonged to one
 * application inside that shape. The judgement is written down because an
 * unexplained gap in a completeness gate is indistinguishable from an
 * oversight.
 */
