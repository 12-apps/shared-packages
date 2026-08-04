/**
 * Local formatting for the research screens. Money is always BRL cents from
 * the engine; dates are ISO strings from the host. Kept internal — hosts
 * needing different locales override the *messages*, not the formatter, until
 * a real second locale exists.
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** `4290` → `R$ 42,90` (NBSP normalized so tests and copy/paste behave). */
export function formatCentsBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/\u00A0/g, ' ');
}

/** Any http(s) URL sitting in free text. */
const URL_IN_TEXT = /https?:\/\/\S+/gi;

/** Nothing secret can hide in a URL without one of these. */
const HAS_REDACTABLE = /[?#@]/;

/** Textual last resort when a match will not parse: cut the query, drop userinfo. */
const cutTextually = (url: string): string =>
  url.replace(/[?#]\S*/, '').replace(/^(https?:\/\/)[^/]*@/i, '$1');

/**
 * The same text with every URL reduced to origin + path (FUT-495). A stored
 * failure reason carries the endpoint that failed — that is the diagnostic part
 * — but a source URL can carry a key in its query OR in its userinfo
 * (`https://user:token@loja…`, which `publicUrlViolation` accepts), and runs
 * recorded before this ticket kept the full `?ft=…` search URL. No surface
 * renders either: the engine strips at write time (`diagnosticUrl`), and this
 * strips again at render time, because a reason is free text from a connector
 * and the UI must not trust it. The two passes must agree — a legacy stored
 * error is precisely the input this one exists for, so it rebuilds the URL the
 * same way rather than cutting at `?`, which left credentials in place.
 */
export function redactQueryStrings(text: string): string {
  return text.replace(URL_IN_TEXT, (match) => {
    // Nothing to strip: leave the recorded text byte-for-byte alone.
    if (!HAS_REDACTABLE.test(match)) return match;
    try {
      const parsed = new URL(match);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return cutTextually(match);
    }
  });
}

/** Row-safe length with an ellipsis; the full text stays in the description. */
export function truncateForRow(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Freshness stamp — `28/07/2026 14:20`. */
export function formatStamp(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}
