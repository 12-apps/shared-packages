import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createCookieCodec } from '../core/cookies';
import { currentRequestScope, eraseCookie, requireRequestScope, writeCookie } from '../core/scope';
import { requestScope } from './index';

describe('requestScope() middleware', () => {
  it('opens a scope the handler can read the request cookies from', async () => {
    const app = new Hono();
    app.use('*', requestScope());
    app.get('/', (c) => c.json({ seen: requireRequestScope().values.get('a') }));

    const res = await app.request('/', { headers: { cookie: 'a=1' } });
    expect(await res.json()).toEqual({ seen: '1' });
  });

  it('drains a queued cookie onto the response', async () => {
    const app = new Hono();
    app.use('*', requestScope());
    app.get('/', (c) => {
      writeCookie(requireRequestScope(), 'planted', 'ok', { path: '/', httpOnly: true });
      return c.json({});
    });

    const res = await app.request('/');
    expect(res.headers.getSetCookie()).toEqual(['planted=ok; Path=/; HttpOnly']);
  });

  it('keeps BOTH a handler-written Set-Cookie and a scope-queued one', async () => {
    // The case Hono's own `c.res` setter would break: its set-cookie branch
    // replaces the incoming list with the previous response's, so merging by
    // assignment drops exactly the cookie this middleware queued. The adapter
    // appends in place instead.
    const app = new Hono();
    app.use('*', requestScope());
    app.get('/', (c) => {
      writeCookie(requireRequestScope(), 'from', 'scope');
      c.header('set-cookie', 'from=handler', { append: true });
      return c.json({});
    });

    const res = await app.request('/');
    expect(res.headers.getSetCookie()).toEqual(['from=handler', 'from=scope']);
  });

  it('rebuilds an immutable redirect so a cookie can be cleared as it redirects', async () => {
    // The OAuth-callback shape: redirect AND drop the state cookie in one
    // answer. Response.redirect() refuses the append, so the adapter rebuilds.
    const app = new Hono();
    app.use('*', requestScope());
    app.get('/cb', () => {
      eraseCookie(requireRequestScope(), 'state', { path: '/' });
      return Response.redirect('https://host.test/done', 307);
    });

    const res = await app.request('/cb');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://host.test/done');
    expect(res.headers.getSetCookie()[0]).toContain('state=');
    expect(res.headers.getSetCookie()[0]).toContain('Max-Age=0');
  });

  it('covers downstream middleware, not just the final handler', async () => {
    const app = new Hono();
    app.use('*', requestScope());
    app.use('*', async (_c, next) => {
      writeCookie(requireRequestScope(), 'refreshed', '1');
      await next();
    });
    app.get('/', (c) => c.json({}));

    const res = await app.request('/');
    expect(res.headers.getSetCookie()).toEqual(['refreshed=1']);
  });

  it('allocates no new response when nothing was queued', async () => {
    const app = new Hono();
    app.use('*', requestScope());
    app.get('/', (c) => c.json({ ok: true }));

    const res = await app.request('/');
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('honours a non-encoding codec', async () => {
    const app = new Hono();
    app.use('*', requestScope({ codec: createCookieCodec({ encode: false }) }));
    app.get('/', (c) => {
      writeCookie(requireRequestScope(), 'tok', 'a=b');
      return c.json({});
    });

    const res = await app.request('/');
    expect(res.headers.getSetCookie()).toEqual(['tok=a=b']);
  });

  it('closes the scope once the request is served', async () => {
    const app = new Hono();
    app.use('*', requestScope());
    app.get('/', (c) => c.json({}));

    await app.request('/');
    expect(currentRequestScope()).toBeUndefined();
  });

  it('leaves a route mounted ABOVE it outside the scope, loudly', async () => {
    // Mount order is the one thing an adopter can get wrong, and the failure
    // should be a throw at the first request rather than a silent absent
    // session. Hono matches in registration order.
    const app = new Hono();
    app.get('/early', (c) => c.json({ scope: currentRequestScope() === undefined }));
    app.use('*', requestScope());

    const res = await app.request('/early');
    expect(await res.json()).toEqual({ scope: true });
  });
});
