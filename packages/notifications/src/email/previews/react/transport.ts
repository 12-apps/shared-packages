import type { EmailPreviewDetail, EmailPreviewIndex } from '../catalog';

/**
 * How the screen reaches its own endpoints.
 *
 * Plain `fetch` rather than a data library: this package cannot know whether a
 * host runs react-query, SWR or nothing at all, and a screen that dragged one
 * in would put a second cache beside whichever the host already has. The two
 * calls here are a list and a document — neither needs invalidation, retries or
 * shared state, which is most of what a data library is for.
 *
 * Both unwrap the `{ data }` envelope the routes write, and both surface a
 * non-2xx as a thrown `Error` carrying whatever the surface said, so the screen
 * can show the operator the real refusal (an unknown locale, a 403 from the
 * host's own gate) rather than a generic failure.
 */

/** The envelope every route in this package answers with. */
interface Envelope<T> {
  data?: T;
  error?: string;
}

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  let body: Envelope<T> = {};
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    // A gate that refuses before the router runs may answer HTML, not JSON.
    // Falling through to the status line below is more useful than a parse
    // error naming a character offset.
  }
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error ?? `The request failed (${response.status}).`);
  }
  return body.data;
}

const withLocale = (base: string, locale: string): string =>
  `${base}?locale=${encodeURIComponent(locale)}`;

/** The catalogue, with every subject rendered in `locale`. */
export function fetchEmailPreviewIndex(
  apiBase: string,
  locale: string,
): Promise<EmailPreviewIndex> {
  return get<EmailPreviewIndex>(withLocale(apiBase, locale));
}

/** One rendered message. */
export function fetchEmailPreview(
  apiBase: string,
  id: string,
  locale: string,
): Promise<EmailPreviewDetail> {
  return get<EmailPreviewDetail>(
    withLocale(`${apiBase}/${encodeURIComponent(id)}`, locale),
  );
}
