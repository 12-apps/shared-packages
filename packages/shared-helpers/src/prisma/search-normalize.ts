/**
 * Accent- and case-insensitive search normalization (FUT-168). Used to keep a
 * denormalized `search_name` column on searchable models (maintained by the
 * audit extension) and to normalize the query at read time, so "sabao" matches
 * "Sabão". DB-agnostic: plain lowercased, diacritic-stripped text works
 * identically on PostgreSQL and PGlite (no `unaccent` extension needed).
 */

/** Unicode combining diacritical marks (U+0300–U+036F), split out by NFD. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Strip diacritics and lowercase. NFD splits accented letters into base +
 * combining mark, then the marks are removed. Using the explicit code-point
 * range (not `\p{Diacritic}`) keeps it valid under the package's compile target.
 */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}
