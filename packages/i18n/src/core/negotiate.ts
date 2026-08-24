/**
 * Which language this reader gets, decided once and in a stated order.
 *
 * The precedence is the whole content of this module, and it is deliberate:
 *
 *   explicit -> user -> tenant -> request -> default
 *
 * - **explicit** is a `?lang=` on the URL, or whatever a host uses for "show me
 *   this page in that language right now". It wins over a stored preference
 *   because it IS a preference, freshly expressed.
 * - **user** is the reader's own saved setting. It beats the tenant's because a
 *   person who chose English does not want their store's default undoing it.
 * - **tenant** is the deployment's or the store's choice — the right answer for
 *   a reader who has never chosen, and the one a host should persist.
 * - **request** is `Accept-Language`, which is a guess made by a browser the
 *   reader may never have configured. Better than nothing, worse than anything
 *   above it.
 * - **default** is {@link DEFAULT_LOCALE}, and it is reached only when every
 *   candidate above was absent or unrecognised.
 *
 * Every candidate is run through {@link matchLocale}, so an unknown tag at one
 * level FALLS THROUGH to the next rather than resolving to the default. A user
 * row holding a stale `es-AR` must not out-rank a tenant that says `en-US`.
 */
import { DEFAULT_LOCALE, type Locale, matchLocale } from './locale';

/** One `Accept-Language` entry: a tag and the quality it was offered at. */
interface WeightedTag {
  tag: string;
  quality: number;
}

/** `q=` on one `Accept-Language` element, defaulting to 1 as the RFC says. */
function qualityOf(parameters: readonly string[]): number {
  for (const parameter of parameters) {
    const [key, value] = parameter.split('=', 2);
    if (key?.trim().toLowerCase() !== 'q') continue;
    const parsed = Number.parseFloat(value ?? '');
    return Number.isFinite(parsed) ? parsed : 1;
  }
  return 1;
}

/**
 * An `Accept-Language` header as tags, best first.
 *
 * `q=0` means "explicitly not this one" and is dropped rather than ranked last
 * — a header of `de, en;q=0` is a reader asking for German and refusing
 * English, and ranking English last would still hand it to them.
 */
export function parseAcceptLanguage(header: string | null | undefined): WeightedTag[] {
  if (typeof header !== 'string') return [];
  return header
    .split(',')
    .map((element) => {
      const [tag, ...parameters] = element.split(';');
      return { tag: (tag ?? '').trim(), quality: qualityOf(parameters) };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && entry.quality > 0)
    .sort((left, right) => right.quality - left.quality);
}

/** The best locale an `Accept-Language` header asks for, or `null`. */
export function negotiateLocale(header: string | null | undefined): Locale | null {
  for (const { tag } of parseAcceptLanguage(header)) {
    const matched = matchLocale(tag);
    if (matched) return matched;
  }
  return null;
}

/**
 * The candidates a host can offer, in no particular order — the ORDER is this
 * module's, not the caller's, so two hosts cannot disagree about precedence.
 */
export interface LocaleCandidates {
  /** A language named on this request: `?lang=`, a path segment, a switcher. */
  explicit?: string | null;
  /** The reader's own saved preference. */
  user?: string | null;
  /** The store's or the deployment's configured language. */
  tenant?: string | null;
  /** The raw `Accept-Language` header. */
  acceptLanguage?: string | null;
}

/** The one locale a request is served in. See the module docstring for the order. */
export function resolveLocale(
  candidates: LocaleCandidates,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  return (
    matchLocale(candidates.explicit) ??
    matchLocale(candidates.user) ??
    matchLocale(candidates.tenant) ??
    negotiateLocale(candidates.acceptLanguage) ??
    fallback
  );
}
