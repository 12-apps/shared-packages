/**
 * `@12-apps/request-scope/hono` — the request scope as a mountable middleware.
 *
 * The framework-neutral core is the contract; this is the adapter for the
 * framework we happen to use, behind its own subpath with `hono` as an OPTIONAL
 * peer (the precedent set by every other adapter in this repo — a host on
 * Express, or one dispatching its own route table, never resolves Hono).
 *
 * ```ts
 * import { requestScope } from '@12-apps/request-scope/hono';
 *
 * app.use('*', requestScope());
 * ```
 *
 * Mount it BEFORE anything that reads a cookie or a header ambiently. A route
 * registered above the middleware runs outside the scope and its accessors
 * throw, which is the intended failure — loud, at the first request, rather than
 * a silently absent session.
 */
import type { Context, MiddlewareHandler } from 'hono';

import { createCookieCodec, type CookieCodec } from '../core/cookies';
import {
  applyResponseCookies,
  createRequestScope,
  runWithRequestScope,
  type RequestScope,
} from '../core/scope';

export interface RequestScopeOptions {
  /**
   * The cookie codec for this host. Defaults to a percent-encoding one; pass
   * `createCookieCodec({ encode: false })` to stay wire-compatible with cookies
   * an earlier implementation wrote raw.
   */
  codec?: CookieCodec;
}

/**
 * Merge the scope's queued cookies onto the response Hono is holding.
 *
 * Appending in place is the fast path AND the correct one, and the fallback is
 * where the care is. Hono's `c.res` SETTER re-merges the outgoing response's
 * headers from the previous one, and its `set-cookie` branch does this:
 *
 * ```js
 * const cookies = this.#res.headers.getSetCookie();  // the OLD list
 * _res.headers.delete('set-cookie');                 // wipes the NEW list
 * for (const cookie of cookies) _res.headers.append('set-cookie', cookie);
 * ```
 *
 * So assigning a response that carries our queued cookies would DROP them and
 * restore only the handler's — exactly and only in the case both must survive.
 * The assignment below is safe despite that, and it is worth being explicit
 * about why rather than leaving it to luck: we only reach it when `append`
 * threw, which means the handler's response has an immutable header list
 * (`Response.redirect()`), which means it cannot be carrying a `Set-Cookie` of
 * its own, so the setter's merge branch never fires.
 *
 * If that reasoning ever stops holding, the symptom is a silently missing
 * cookie on a redirect — `hono/__tests__/adapter.test.ts` pins both halves.
 */
function mergeCookies(c: Context, scope: RequestScope): void {
  if (scope.setCookies.length === 0) return;
  try {
    for (const cookie of scope.setCookies) {
      c.res.headers.append('set-cookie', cookie);
    }
  } catch {
    c.res = applyResponseCookies(scope, c.res);
  }
}

/**
 * Open an ambient request scope for the duration of the request.
 *
 * The scope wraps `next()` rather than only the handler, so a cookie written by
 * a downstream middleware — an auth layer refreshing a session, say — is queued
 * on the same scope and lands on the same response.
 */
export function requestScope(options: RequestScopeOptions = {}): MiddlewareHandler {
  const codec = options.codec ?? createCookieCodec();
  return async (c, next) => {
    const scope = createRequestScope(c.req.raw, codec);
    await runWithRequestScope(scope, () => next());
    mergeCookies(c, scope);
  };
}
