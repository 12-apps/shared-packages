/**
 * The ambient per-request store.
 *
 * A web-standard handler is given a `Request` and returns a `Response`, which is
 * a clean contract right up until something twelve calls deep needs to know who
 * the caller is. The two ways out are threading the `Request` through every
 * intervening signature — turning a transport detail into a parameter of the
 * domain layer — or an ambient accessor. This package is the second one, with
 * its backing store made explicit: one `AsyncLocalStorage`, entered once per
 * request by a server adapter.
 *
 * The store is also where a cookie WRITE goes, and that is the half people
 * underestimate. A helper deep in the call chain has no response to attach a
 * `Set-Cookie` to; it can only queue the intent. The adapter drains
 * {@link RequestScope.setCookies} onto the handler's `Response` on the way out
 * (see {@link applyResponseCookies}).
 *
 * Server-only: `AsyncLocalStorage` is a Node API. Never import this from an Edge
 * runtime or a browser bundle.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { createCookieCodec, type CookieCodec, type CookieOptions } from './cookies';

/** Everything one request's scope holds. */
export interface RequestScope {
  /** The incoming request, exactly as the server received it. */
  request: Request;
  /**
   * Cookie values as the handler currently sees them: parsed from the request
   * and overlaid with anything written during this request, so a `get` after a
   * `set` observes the new value rather than the browser's stale one.
   */
  values: Map<string, string>;
  /** `Set-Cookie` header values to append to the response. */
  setCookies: string[];
  /** The codec this scope reads and writes cookies with. */
  codec: CookieCodec;
}

/**
 * WHERE the store lives, and why that is config.
 *
 * The `AsyncLocalStorage` instance is kept on `globalThis` so a dev server that
 * re-evaluates this module (hot reload) cannot create a second store whose
 * context is invisible to closures captured against the first — the failure
 * mode being that `require()` starts returning `undefined` for a request that
 * demonstrably has a scope open.
 *
 * The KEY is a cross-module contract rather than a private detail, for the same
 * reason `@12-apps/audit` makes its actor-store key configurable: a host that
 * already has an in-house request-scope module, with call sites importing it,
 * needs BOTH modules on ONE store. Declare that with
 * {@link declareRequestScopeKey} at wiring time.
 *
 * Two stores that disagree do not fail loudly. The accessors read a store
 * nothing ever entered, throw "outside a request scope" from inside a perfectly
 * ordinary request, and every suite that stamps through its own store stays
 * green.
 */
export const DEFAULT_REQUEST_SCOPE_KEY = '__12appsRequestScopeStore';

const globalStore = globalThis as unknown as Record<
  string | symbol,
  AsyncLocalStorage<RequestScope> | undefined
>;

const storeKey: { declared: string | symbol; created?: string | symbol } = {
  declared: DEFAULT_REQUEST_SCOPE_KEY,
};

/** Raised when the scope is mis-wired at assembly time. A boot failure. */
export class RequestScopeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestScopeConfigError';
  }
}

/**
 * Share the request scope with another module, by naming its `globalThis` key.
 *
 * Call it ONCE, at wiring time, before anything opens or reads a scope. Moving
 * the key after a store exists would strand every scope already entered under
 * the old one, so that is refused rather than silently honoured.
 */
export function declareRequestScopeKey(key: string | symbol): void {
  if (storeKey.created !== undefined && storeKey.created !== key) {
    throw new RequestScopeConfigError(
      'declareRequestScopeKey() was called after the request-scope store was ' +
        'already created. Move the call to wiring time, before the first ' +
        'request is served.',
    );
  }
  storeKey.declared = key;
}

const store = (): AsyncLocalStorage<RequestScope> => {
  storeKey.created ??= storeKey.declared;
  return (globalStore[storeKey.declared] ??= new AsyncLocalStorage<RequestScope>());
};

/** Build a fresh scope for one request. */
export function createRequestScope(request: Request, codec?: CookieCodec): RequestScope {
  const cookieCodec = codec ?? createCookieCodec();
  return {
    request,
    values: cookieCodec.parse(request.headers.get('cookie')),
    setCookies: [],
    codec: cookieCodec,
  };
}

/** Run `fn` with `scope` as the ambient request scope. */
export function runWithRequestScope<T>(scope: RequestScope, fn: () => T): T {
  return store().run(scope, fn);
}

/**
 * The ambient scope, or `undefined` outside a request.
 *
 * For callers that treat "no request here" as a normal state — a background job,
 * a boot-time task, a CLI. Callers that must fail loudly use
 * {@link requireRequestScope}.
 */
export function currentRequestScope(): RequestScope | undefined {
  return store().getStore();
}

/**
 * The ambient scope, or a thrown error.
 *
 * The throw is load-bearing rather than defensive. Code that reads an optional
 * credential — a bearer header, an impersonation cookie — wraps this in a `try`
 * and treats a throw as "there is no incoming request, so there is no
 * credential". Returning `undefined` instead would collapse that into the same
 * answer as "a request with no such cookie", and the two need different
 * handling: one is a background job, the other is an anonymous visitor.
 */
export function requireRequestScope(): RequestScope {
  const scope = store().getStore();
  if (!scope) {
    throw new Error(
      'No request scope is open. The ambient cookie/header accessors are only ' +
        'available inside a handler running under runWithRequestScope() — mount ' +
        'the adapter (e.g. requestScope() from @12-apps/request-scope/hono), or ' +
        'use currentRequestScope() if this code also runs outside a request.',
    );
  }
  return scope;
}

/** Record a cookie write for the outgoing response, and make it readable now. */
export function writeCookie(
  scope: RequestScope,
  name: string,
  value: string,
  options?: CookieOptions,
): void {
  scope.values.set(name, value);
  scope.setCookies.push(scope.codec.serialize(name, value, options));
}

/** Record a cookie deletion for the outgoing response. */
export function eraseCookie(
  scope: RequestScope,
  name: string,
  options?: CookieOptions,
): void {
  scope.values.delete(name);
  scope.setCookies.push(scope.codec.serializeDeletion(name, options));
}

/**
 * Merge the request's pending cookie writes into the handler's response.
 *
 * `append`, never `set`: a handler is free to have written its own `Set-Cookie`
 * directly on the `Response`, and both sources must survive. Returns the same
 * response when there is nothing to merge, so the common path allocates nothing.
 *
 * `Response.redirect()` is the one shape whose header list is IMMUTABLE per
 * spec, so appending to it throws. That is not hypothetical — an OAuth callback
 * that redirects AND clears its state cookie in the same answer hits it every
 * time. Rather than forbid the built-in (a rule the next handler rediscovers as
 * a 500), the response is rebuilt when its headers refuse the write.
 */
export function applyResponseCookies(scope: RequestScope, response: Response): Response {
  if (scope.setCookies.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const cookie of scope.setCookies) {
    headers.append('set-cookie', cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The whole dance in one call, for a host that dispatches its own route table
 * rather than composing middleware: open a scope, run the handler inside it, and
 * merge the queued cookies onto whatever it returned.
 *
 * A Hono host wants `requestScope()` from `./hono` instead — as middleware the
 * scope also covers everything downstream of it, not just the final handler.
 */
export async function serveWithRequestScope(
  request: Request,
  handle: () => Promise<Response> | Response,
  codec?: CookieCodec,
): Promise<Response> {
  const scope = createRequestScope(request, codec);
  const response = await runWithRequestScope(scope, async () => handle());
  return applyResponseCookies(scope, response);
}
