/**
 * `@12-apps/request-scope` — the ambient per-request scope for a host serving
 * web-standard `Request`/`Response`.
 *
 * This entry point is framework-free: it needs `node:async_hooks` and nothing
 * else. Mount it with the adapter for whatever is dispatching your routes
 * (`./hono`), and reach for `./next-compat` only if you are migrating off
 * `next/headers` and want the call sites to stay as they are.
 *
 * ```ts
 * import { createRequestScope, runWithRequestScope, applyResponseCookies }
 *   from '@12-apps/request-scope';
 *
 * const scope = createRequestScope(request);
 * const response = await runWithRequestScope(scope, () => handler(request));
 * return applyResponseCookies(scope, response);
 * ```
 */
export {
  createCookieCodec,
  type CookieCodec,
  type CookieCodecOptions,
  type CookieOptions,
  type RequestCookie,
} from './core/cookies';

export {
  applyResponseCookies,
  createRequestScope,
  currentRequestScope,
  declareRequestScopeKey,
  DEFAULT_REQUEST_SCOPE_KEY,
  eraseCookie,
  requireRequestScope,
  RequestScopeConfigError,
  runWithRequestScope,
  serveWithRequestScope,
  writeCookie,
  type RequestScope,
} from './core/scope';

export {
  deleteResponseCookie,
  redirectResponse,
  setResponseCookie,
} from './core/response';
