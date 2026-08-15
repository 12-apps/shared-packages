import { describe, expect, it } from 'vitest';

import { createCookieCodec } from './cookies';
import {
  applyResponseCookies,
  createRequestScope,
  currentRequestScope,
  eraseCookie,
  requireRequestScope,
  runWithRequestScope,
  serveWithRequestScope,
  writeCookie,
} from './scope';

const requestWith = (cookie?: string): Request =>
  new Request('https://host.test/x', { headers: cookie ? { cookie } : {} });

describe('the ambient scope', () => {
  it('is undefined outside a request, for callers that expect that', () => {
    expect(currentRequestScope()).toBeUndefined();
  });

  it('throws outside a request, for callers that must fail loudly', () => {
    // Load-bearing: readers of an optional credential catch this and treat it
    // as "no incoming request". Returning undefined would make that
    // indistinguishable from "a request with no such cookie".
    expect(() => requireRequestScope()).toThrow(/No request scope is open/);
  });

  it('is readable inside runWithRequestScope', () => {
    const scope = createRequestScope(requestWith('a=1'));
    runWithRequestScope(scope, () => {
      expect(requireRequestScope()).toBe(scope);
      expect(currentRequestScope()?.values.get('a')).toBe('1');
    });
  });

  it('survives a microtask AND a macrotask boundary', async () => {
    const scope = createRequestScope(requestWith());
    await runWithRequestScope(scope, async () => {
      await Promise.resolve();
      expect(requireRequestScope()).toBe(scope);
      await new Promise((resolve) => setImmediate(resolve));
      expect(requireRequestScope()).toBe(scope);
    });
  });

  it('does not leak between concurrent requests', async () => {
    // The property the whole design rests on: two requests in flight at once
    // must never observe each other's scope.
    //
    // Gated rather than timed. A sleep would only prove the two ran at
    // different speeds; holding `alice` open while `bob` opens AND closes an
    // entire scope of its own proves the interleaving that actually matters,
    // and does it deterministically.
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => {
      gate.release = resolve;
    });

    const run = async (name: string, wait: boolean): Promise<string | undefined> => {
      const scope = createRequestScope(requestWith(`who=${name}`));
      return runWithRequestScope(scope, async () => {
        if (wait) await held;
        return requireRequestScope().values.get('who');
      });
    };

    const alice = run('alice', true);
    const bob = run('bob', false);
    expect(await bob).toBe('bob');
    gate.release();
    expect(await alice).toBe('alice');
  });

  it('is closed again once the callback returns', async () => {
    await runWithRequestScope(createRequestScope(requestWith()), async () => {
      expect(currentRequestScope()).toBeDefined();
    });
    expect(currentRequestScope()).toBeUndefined();
  });
});

describe('cookie writes through the scope', () => {
  it('makes a write readable immediately, before any response exists', () => {
    const scope = createRequestScope(requestWith('a=1'));
    writeCookie(scope, 'a', '2');
    expect(scope.values.get('a')).toBe('2');
  });

  it('makes a deletion unreadable immediately', () => {
    const scope = createRequestScope(requestWith('a=1'));
    eraseCookie(scope, 'a');
    expect(scope.values.has('a')).toBe(false);
  });

  it('queues one Set-Cookie per write', () => {
    const scope = createRequestScope(requestWith());
    writeCookie(scope, 'a', '1', { path: '/' });
    writeCookie(scope, 'b', '2');
    expect(scope.setCookies).toHaveLength(2);
  });

  it('uses the codec the scope was built with', () => {
    const scope = createRequestScope(requestWith(), createCookieCodec({ encode: false }));
    writeCookie(scope, 'tok', 'a=b');
    expect(scope.setCookies[0]).toBe('tok=a=b');
  });
});

describe('applyResponseCookies', () => {
  it('returns the very same response when nothing was queued', () => {
    const scope = createRequestScope(requestWith());
    const response = Response.json({ ok: true });
    expect(applyResponseCookies(scope, response)).toBe(response);
  });

  it('APPENDS, so a Set-Cookie the handler wrote itself also survives', () => {
    const scope = createRequestScope(requestWith());
    writeCookie(scope, 'from', 'scope');
    const response = Response.json({ ok: true });
    response.headers.append('set-cookie', 'from=handler');

    const merged = applyResponseCookies(scope, response);
    expect(merged.headers.getSetCookie()).toEqual(['from=handler', 'from=scope']);
  });

  it('rebuilds an immutable redirect rather than throwing', async () => {
    // Response.redirect() has an immutable header list per spec, and
    // "redirect while clearing a cookie" is an ordinary thing to want.
    const scope = createRequestScope(requestWith());
    eraseCookie(scope, 'state');
    const redirect = Response.redirect('https://host.test/done', 302);
    expect(() => redirect.headers.append('set-cookie', 'x=1')).toThrow();

    const merged = applyResponseCookies(scope, redirect);
    expect(merged.status).toBe(302);
    expect(merged.headers.get('location')).toBe('https://host.test/done');
    expect(merged.headers.getSetCookie()[0]).toContain('state=');
  });

  it('preserves status, statusText and body when it rebuilds', async () => {
    const scope = createRequestScope(requestWith());
    writeCookie(scope, 'a', '1');
    const merged = applyResponseCookies(
      scope,
      new Response('payload', { status: 201, statusText: 'Created' }),
    );
    expect(merged.status).toBe(201);
    expect(merged.statusText).toBe('Created');
    expect(await merged.text()).toBe('payload');
  });
});

describe('serveWithRequestScope', () => {
  it('opens the scope, runs the handler and merges the queued cookies', async () => {
    const response = await serveWithRequestScope(requestWith('seen=yes'), async () => {
      const scope = requireRequestScope();
      expect(scope.values.get('seen')).toBe('yes');
      writeCookie(scope, 'planted', 'ok', { path: '/' });
      return Response.json({ ok: true });
    });
    expect(response.headers.getSetCookie()).toEqual(['planted=ok; Path=/']);
  });

  it('closes the scope again afterwards', async () => {
    await serveWithRequestScope(requestWith(), () => Response.json({}));
    expect(currentRequestScope()).toBeUndefined();
  });
});
