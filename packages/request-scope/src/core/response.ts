/**
 * Explicit cookie writes on a `Response`, for code that HAS one in hand.
 *
 * The ambient jar exists for helpers with no response to attach to. A handler
 * that just built one does not need the indirection, and reads better without
 * it: the write is visible at the line that returns the answer rather than
 * queued in a side channel the reader has to know about.
 *
 * Both helpers return the response so a handler can write `return
 * setResponseCookie(res, ...)`.
 *
 * These take a codec explicitly rather than reaching for the ambient scope,
 * which keeps them usable outside a request (a test, a job that mints a
 * response) and keeps the encoding decision in one visible place.
 */
import { createCookieCodec, type CookieCodec, type CookieOptions } from './cookies';

const defaultCodec = createCookieCodec();

/** Attach a `Set-Cookie` to an outgoing response. */
export function setResponseCookie(
  response: Response,
  name: string,
  value: string,
  options?: CookieOptions,
  codec: CookieCodec = defaultCodec,
): Response {
  response.headers.append('set-cookie', codec.serialize(name, value, options));
  return response;
}

/** Attach the `Set-Cookie` that clears a cookie. */
export function deleteResponseCookie(
  response: Response,
  name: string,
  options?: CookieOptions,
  codec: CookieCodec = defaultCodec,
): Response {
  response.headers.append('set-cookie', codec.serializeDeletion(name, options));
  return response;
}

/**
 * A redirect whose headers can still be written to.
 *
 * `Response.redirect()` is specified to return an immutable header list, so
 * appending a `Set-Cookie` to it throws — and redirecting while clearing a
 * cookie is a completely ordinary thing to want (an OAuth callback dropping its
 * state cookie, an impersonation exit). Building it through the constructor
 * keeps the headers mutable.
 *
 * The default status is **307, not the 302** `Response.redirect()` gives. Both
 * land a browser on the same page for a GET callback, but 307 preserves the
 * method — so a redirect added to a non-GET handler later behaves as written
 * rather than silently downgrading the follow-up to a GET and losing the body.
 */
export function redirectResponse(url: string | URL, status = 307): Response {
  return new Response(null, { status, headers: { location: String(url) } });
}
