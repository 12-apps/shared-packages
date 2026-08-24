/**
 * `@12-apps/request-scope` as a CONSUMER gets it: the middleware mounted once
 * in front of everything, read through the `next-compat` shims a host migrating
 * off `next/headers` keeps its call sites on.
 *
 * This package had no presence in either harness half, and its absence was the
 * least visible of any: every other surface here uses it INDIRECTLY — a handler
 * that reads a cookie reads it through this — so nothing failed and nothing
 * proved it either.
 *
 * Three properties, and only one of them is about a single request:
 *
 * - **absence is not emptiness** — both accessors throw OUTSIDE a request, so a
 *   background job cannot be mistaken for an anonymous visitor;
 * - **a queued cookie survives a redirect**, the case the package's own adapter
 *   docblock identifies as the one where its fast path throws;
 * - **concurrent requests do not see each other's scope**, which is the entire
 *   reason this package reaches for `node:async_hooks` and is invisible to any
 *   test that makes one request at a time.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { readOutsideRequest, SCOPE_COOKIE } from '../src/request-scope-host';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

function read(cookie?: string): Promise<Response> {
  return backend.app.request('/__harness/scope/read', {
    headers: {
      'user-agent': 'harness-probe',
      ...(cookie === undefined ? {} : { cookie: `${SCOPE_COOKIE}=${cookie}` }),
    },
  });
}

describe('what the incoming request carried', () => {
  it('reads a cookie and a header through the next-compat shims', async () => {
    const body = (await (await read('alfa')).json()) as {
      cookie: string | null;
      userAgent: string | null;
    };
    expect(body.cookie).toBe('alfa');
    expect(body.userAgent).toBe('harness-probe');
  });

  it('answers null for a cookie the request did not send', async () => {
    // The other half of the rule below: a MISSING cookie is an ordinary answer.
    // If this threw, a host could not tell an anonymous visitor from a bug.
    const body = (await (await read()).json()) as { cookie: string | null };
    expect(body.cookie).toBeNull();
  });

  it('decodes a value the codec encoded', async () => {
    // The default codec percent-encodes, so a value carrying a `;` or a space
    // survives the wire. A host migrating off an implementation that wrote raw
    // values passes `createCookieCodec({ encode: false })` instead — which is
    // why the mount states the choice rather than taking the default silently.
    const body = (await (await read(encodeURIComponent('a b;c'))).json()) as {
      cookie: string | null;
    };
    expect(body.cookie).toBe('a b;c');
  });
});

describe('outside a request', () => {
  it('throws rather than answering an empty scope', async () => {
    // The distinction the package is built to preserve: "there is no incoming
    // request" is a different fact from "a request with no such cookie", and a
    // scope that answered undefined for both would make a background job look
    // like an anonymous visitor to every guard that consults it.
    //
    // There is no endpoint that can ask this, because being reachable by HTTP
    // is exactly the condition that makes a scope exist.
    const outcome = await readOutsideRequest();
    expect(outcome.threw).toBe(true);
    expect(outcome.message).not.toBe('');
  });
});

describe('a cookie the handler queued', () => {
  it('reaches the response', async () => {
    const response = await backend.app.request('/__harness/scope/write/bravo');
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(`${SCOPE_COOKIE}=bravo`);
  });

  it('survives a redirect, where the fast path cannot append', async () => {
    // `Response.redirect()` has an IMMUTABLE header list, so the adapter's
    // in-place append throws and its fallback has to rebuild the response. The
    // package's own docblock says the symptom of that reasoning failing is a
    // silently missing cookie on exactly this path — which is the shape of bug
    // that reaches production as "sometimes people get signed out".
    const response = await backend.app.request('/__harness/scope/write-then-redirect/charlie');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/__harness/scope/read');
    expect(response.headers.get('set-cookie')).toContain(`${SCOPE_COOKIE}=charlie`);
  });
});

describe('two requests in flight at once', () => {
  it('keeps each one reading its own cookie', async () => {
    // THE reason this package needs `node:async_hooks`. The first request reads
    // its cookie, suspends across an await long enough for the second to run
    // start to finish, then reads again — and must still see its own value.
    //
    // A scope held in a module-level variable passes every single-request case
    // above and fails here, answering the LAST request's cookie to whichever
    // one happens to resume. Nothing in a sequential suite can see that.
    const slow = backend.app.request('/__harness/scope/read-slow/40', {
      headers: { cookie: `${SCOPE_COOKIE}=first` },
    });
    // Deliberately not awaited before the second: the interleaving is the test.
    const fast = backend.app.request('/__harness/scope/read-slow/0', {
      headers: { cookie: `${SCOPE_COOKIE}=second` },
    });

    const [slowBody, fastBody] = (await Promise.all(
      [await slow, await fast].map((response) => response.json()),
    )) as { before: string | null; after: string | null }[];

    expect(slowBody).toEqual({ before: 'first', after: 'first' });
    expect(fastBody).toEqual({ before: 'second', after: 'second' });
  });

  it('gives a request with no cookie nothing from the one beside it', async () => {
    // The same race in the direction that leaks: an anonymous request running
    // alongside a signed-in one must stay anonymous. A shared scope shows up
    // here as somebody else's session appearing on a request that sent none.
    const anonymous = backend.app.request('/__harness/scope/read-slow/40');
    const signedIn = backend.app.request('/__harness/scope/read-slow/0', {
      headers: { cookie: `${SCOPE_COOKIE}=delta` },
    });

    const [anonymousBody, signedInBody] = (await Promise.all(
      [await anonymous, await signedIn].map((response) => response.json()),
    )) as { before: string | null; after: string | null }[];

    expect(anonymousBody).toEqual({ before: null, after: null });
    expect(signedInBody).toEqual({ before: 'delta', after: 'delta' });
  });
});
