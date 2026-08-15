/**
 * `@12-apps/request-scope/next-compat` — `cookies()` and `headers()` with the
 * shapes `next/headers` gave them.
 *
 * This subpath exists for ONE purpose: letting a codebase move off the Next App
 * Router without editing the call sites that read a cookie. Same names, same
 * shapes, same async signatures, same throw-outside-a-request behaviour — so a
 * module that read the cart cookie, the consent token or the incoming bearer
 * changes its import line and nothing else.
 *
 * **Prefer the core API in new code.** These accessors are `async` with nothing
 * to await, which is a Next 15 artifact rather than a design: Next made them
 * async so it could make them lazy later, and the call sites here are already
 * `await`ed. A greenfield host has no such call sites and is better served by
 * `requireRequestScope()`, which says what it does.
 */
import type { CookieOptions, RequestCookie } from '../core/cookies';
import { eraseCookie, requireRequestScope, writeCookie } from '../core/scope';

/** The cookie jar handed to callers, matching `next/headers`' shape. */
export interface ReadonlyCookieStore {
  get: (name: string) => RequestCookie | undefined;
  has: (name: string) => boolean;
  set: (name: string, value: string, options?: CookieOptions) => void;
  delete: (name: string, options?: CookieOptions) => void;
}

/** The incoming request headers. Throws outside a request scope. */
export async function headers(): Promise<Headers> {
  return requireRequestScope().request.headers;
}

/**
 * The request's cookie jar. Throws outside a request scope.
 *
 * Writes are queued onto the scope and merged into the response by the adapter
 * — the same indirection Next used, for the same reason: a helper deep in the
 * call chain has no response to attach a cookie to.
 */
export async function cookies(): Promise<ReadonlyCookieStore> {
  const scope = requireRequestScope();
  return {
    get: (name) => {
      const value = scope.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    has: (name) => scope.values.has(name),
    set: (name, value, options) => writeCookie(scope, name, value, options),
    delete: (name, options) => eraseCookie(scope, name, options),
  };
}
