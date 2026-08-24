/**
 * The locales this family of packages speaks, and how a tag becomes one.
 *
 * ONE canonical list, in ONE place. Every package that ships copy keys its
 * locale pack by these exact tags, and the parity gate
 * (`scripts/locale-coverage-gate.mjs`) reads the list from here rather than
 * from a second copy — a hand-kept duplicate is how "we support English" turns
 * into "we support English in eleven of nineteen packages" with nothing red.
 *
 * The ORDER is load-bearing in exactly one place: {@link matchLocale} falls
 * back to the first entry sharing a language, so `pt` resolves to `pt-BR` and
 * `en-GB` to `en-US`. It is NOT the default — that is {@link DEFAULT_LOCALE},
 * which is stated separately so widening the list can never silently move it.
 */

/** Every tag a pack may be keyed by. BCP-47, `language-REGION`. */
export const LOCALES = ['pt-BR', 'en-US'] as const;

/** One of {@link LOCALES}. */
export type Locale = (typeof LOCALES)[number];

/**
 * What a host gets when nothing else answers.
 *
 * pt-BR, and deliberately so while the second language is being adopted: every
 * consumer of these packages today renders Portuguese, so a default of anything
 * else would be a silent behaviour change dressed up as a feature. It is a
 * NAMED constant rather than `LOCALES[0]` so that reordering the list, or
 * adding a locale in front of it, cannot move it by accident.
 */
export const DEFAULT_LOCALE: Locale = 'pt-BR';

/** Whether an arbitrary value is one of the canonical tags. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The `language` half of a BCP-47 tag, lower-cased. `pt-BR` -> `pt`. */
function languageOf(tag: string): string {
  const cut = tag.indexOf('-');
  return (cut === -1 ? tag : tag.slice(0, cut)).toLowerCase();
}

/**
 * A tag from the outside world as one of ours, or `null` when nothing matches.
 *
 * Three steps, narrowest first:
 *
 *   1. exact, case-insensitively — `pt-br` and `PT-BR` are `pt-BR`;
 *   2. language only — `pt` is `pt-BR`;
 *   3. same language, different region — `en-GB` is `en-US`, because a British
 *      reader given English is served and a British reader given Portuguese is
 *      not. Rendering the region's own spelling is a later problem; rendering
 *      the wrong LANGUAGE is the one worth solving now.
 *
 * `null` rather than {@link DEFAULT_LOCALE} on no match, because the caller is
 * the only one who knows whether an unmatched tag should fall through to the
 * next candidate (a cookie, then a header, then the default) or stop here.
 */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (typeof tag !== 'string') return null;
  const trimmed = tag.trim();
  if (trimmed === '') return null;

  const exact = LOCALES.find((locale) => locale.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const language = languageOf(trimmed);
  return LOCALES.find((locale) => languageOf(locale) === language) ?? null;
}
