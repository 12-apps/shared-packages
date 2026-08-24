/**
 * `@12-apps/request-scope` mounted the way a host mounts it: once, as
 * middleware, in front of everything.
 *
 * This package had no presence in either harness half, and it is the one whose
 * absence was least obvious — every other surface here USES it indirectly (a
 * handler that reads a cookie reads it through this), so nothing failed and
 * nothing proved it either.
 *
 * ## What a host owns, and it is almost nothing
 *
 * One `app.use('*', requestScope())` and a codec choice. That is deliberate:
 * the scope is ambient, so a host that had to thread it through would be
 * carrying the thing the package exists to remove. The probes below are the
 * host's own endpoints — a real adopter's equivalents are its auth layer and
 * its route handlers — and they exist because an ambient value can only be
 * observed from inside a request.
 *
 * ## The three properties worth a probe
 *
 * - **Absence is not emptiness.** Both accessors THROW outside a request, so
 *   "there is no incoming request" stays distinguishable from "a request with
 *   no such cookie". A scope that answered `undefined` for both would make a
 *   background job silently look like an anonymous visitor.
 * - **A queued cookie reaches the response**, including through a redirect —
 *   the case the package's own adapter docblock says is the one where an
 *   in-place append fails and the fallback has to fire.
 * - **Concurrent requests do not see each other.** This is the reason the
 *   package needs `node:async_hooks` at all, and it is invisible to any test
 *   that makes one request at a time.
 */
import { Hono } from 'hono';
import {
  createCookieCodec,
  redirectResponse,
  requireRequestScope,
  writeCookie,
} from '@12-apps/request-scope';
import { requestScope } from '@12-apps/request-scope/hono';
import { cookies, headers } from '@12-apps/request-scope/next-compat';

/** The cookie this host writes and reads back. */
export const SCOPE_COOKIE = 'harness_scope_probe';

/**
 * The host's mount, and the only line an adopter genuinely writes.
 *
 * The default percent-encoding codec is stated rather than left implicit: a
 * host migrating off an earlier implementation that wrote raw values passes
 * `createCookieCodec({ encode: false })` instead, and a harness that never
 * named the choice would not show there is one.
 */
export function mountRequestScope(app: Hono): void {
  app.use('*', requestScope({ codec: createCookieCodec() }));
}

/**
 * The host endpoints that make an ambient value observable.
 *
 * Mounted under `/__harness/scope` because they are the SUITE's, not any
 * package's — the same place the other harness probes live.
 */
export function requestScopeProbes(): Hono {
  const app = new Hono();

  /** What the incoming request carried, read through the next-compat shims. */
  app.get('/read', async (c) => {
    const cookieStore = await cookies();
    const headerStore = await headers();
    return c.json({
      // `?? null` rather than a default: the point of the case that reads this
      // is that a MISSING cookie is a normal answer, unlike a missing scope.
      cookie: cookieStore.get(SCOPE_COOKIE)?.value ?? null,
      userAgent: headerStore.get('user-agent'),
    });
  });

  /**
   * Queue a cookie on the AMBIENT scope, and answer normally.
   *
   * `writeCookie` rather than `setResponseCookie`: the latter takes a Response
   * in hand and attaches the header directly, which is the right call for a
   * handler that just built one. This probe is the other shape — the queue a
   * helper with no response to attach to uses, which is the whole reason the
   * ambient jar exists and the only half the adapter has to merge.
   */
  app.get('/write/:value', (c) => {
    writeCookie(requireRequestScope(), SCOPE_COOKIE, c.req.param('value'), { path: '/' });
    return c.json({ queued: true });
  });

  /**
   * Queue a cookie and then REDIRECT.
   *
   * `Response.redirect()` has an immutable header list, so the adapter's
   * in-place append throws and its fallback has to rebuild the response. The
   * package's own docblock says the symptom of that reasoning failing is a
   * silently missing cookie on a redirect, which is what this probe exposes.
   */
  app.get('/write-then-redirect/:value', (c) => {
    writeCookie(requireRequestScope(), SCOPE_COOKIE, c.req.param('value'), { path: '/' });
    return redirectResponse('/__harness/scope/read', 302);
  });

  /**
   * Read the scope's cookie AFTER an await that outlives another request.
   *
   * The delay is the whole probe: it forces this request to be suspended while
   * a second one runs, which is exactly the interleaving an ambient scope built
   * on a module-level variable gets wrong.
   */
  app.get('/read-slow/:ms', async (c) => {
    const store = await cookies();
    const before = store.get(SCOPE_COOKIE)?.value ?? null;
    await new Promise((resolve) => setTimeout(resolve, Number(c.req.param('ms'))));
    const after = (await cookies()).get(SCOPE_COOKIE)?.value ?? null;
    return c.json({ before, after });
  });

  return app;
}

/**
 * Read the scope from OUTSIDE any request — what a background job does.
 *
 * Exported for the suite rather than mounted: there is no endpoint that can ask
 * this question, because being reachable by HTTP is precisely the condition
 * that makes a scope exist.
 */
export async function readOutsideRequest(): Promise<{ threw: boolean; message: string }> {
  try {
    await cookies();
    return { threw: false, message: '' };
  } catch (error) {
    return { threw: true, message: error instanceof Error ? error.message : String(error) };
  }
}
