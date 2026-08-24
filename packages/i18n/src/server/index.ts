/**
 * The locale a web-standard `Request` is asking for.
 *
 * Framework-free by construction — it reads a `Request` and nothing else — so
 * a Hono host, a Next host and a bare `fetch` handler all get the same answer
 * from the same code. Mounting it into an ambient per-request scope is the
 * host's job (`@12-apps/request-scope` is the seam for it here); this module
 * deliberately does not reach for one, because a package that can only be
 * called inside somebody's AsyncLocalStorage is not portable.
 *
 * It returns `null` when the request names no language it recognises, rather
 * than falling back. The fallback belongs to {@link resolveLocale}, which is
 * where the request sits BELOW a stored user preference — and a function that
 * quietly answered `pt-BR` here would out-rank the preference it is supposed
 * to lose to.
 */
import { matchLocale, type Locale } from '../core/locale';
import { negotiateLocale } from '../core/negotiate';

/** Where a chosen language is remembered between requests, by convention. */
export const LOCALE_COOKIE = 'locale';

/** Where a request names a language explicitly, by convention. */
export const LOCALE_QUERY_PARAM = 'lang';

export interface RequestLocaleOptions {
  /** Query parameter carrying an explicit choice. Defaults to `lang`. */
  queryParam?: string;
  /** Cookie carrying a remembered choice. Defaults to `locale`. */
  cookieName?: string;
  /** Set false to ignore `Accept-Language` entirely. Defaults to true. */
  acceptLanguage?: boolean;
}

/**
 * One cookie's value out of a `Cookie` header.
 *
 * Hand-parsed rather than pulled from a cookie library: this package has no
 * dependencies, and the shape needed here is one name out of a `; `-separated
 * list. A value is NOT url-decoded — a BCP-47 tag has no character that needs
 * encoding, and decoding would only widen what a header can smuggle in.
 */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const cut = part.indexOf('=');
    if (cut === -1) continue;
    if (part.slice(0, cut).trim() !== name) continue;
    return part.slice(cut + 1).trim();
  }
  return null;
}

/**
 * The locale this request names, in the order the request itself ranks them:
 * an explicit `?lang=`, then the remembered cookie, then `Accept-Language`.
 *
 * This is the REQUEST half only. A stored user or tenant preference outranks
 * the header and is not visible from here — hand this result to
 * {@link resolveLocale} as its `explicit`/`acceptLanguage` inputs alongside
 * those, rather than treating it as the final answer.
 */
export function localeFromRequest(
  request: Request,
  options: RequestLocaleOptions = {},
): Locale | null {
  const {
    queryParam = LOCALE_QUERY_PARAM,
    cookieName = LOCALE_COOKIE,
    acceptLanguage = true,
  } = options;

  const url = new URL(request.url);
  const explicit = matchLocale(url.searchParams.get(queryParam));
  if (explicit) return explicit;

  const remembered = matchLocale(readCookie(request.headers.get('cookie'), cookieName));
  if (remembered) return remembered;

  return acceptLanguage ? negotiateLocale(request.headers.get('accept-language')) : null;
}
