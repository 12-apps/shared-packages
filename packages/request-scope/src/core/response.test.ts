import { describe, expect, it } from 'vitest';

import { createCookieCodec } from './cookies';
import { deleteResponseCookie, redirectResponse, setResponseCookie } from './response';
import { applyResponseCookies, createRequestScope, writeCookie } from './scope';

describe('setResponseCookie', () => {
  it('attaches the cookie and returns the SAME response', () => {
    const response = Response.json({ ok: true });
    expect(setResponseCookie(response, 'k', 'v')).toBe(response);
    expect(response.headers.getSetCookie()).toEqual(['k=v']);
  });

  it('appends rather than replacing, so two cookies both survive', () => {
    const response = Response.json({});
    setResponseCookie(response, 'a', '1');
    setResponseCookie(response, 'b', '2');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
  });

  it('works on a 204, which a fire-and-forget endpoint answers', () => {
    // A 204 must keep a null body. Writing a cookie onto one is an ordinary
    // shape — "record this and tell me nothing".
    const response = setResponseCookie(new Response(null, { status: 204 }), 'k', 'v');
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.getSetCookie()).toEqual(['k=v']);
  });

  it('honours a non-default codec', () => {
    const response = Response.json({});
    setResponseCookie(response, 'tok', 'a=b', undefined, createCookieCodec({ encode: false }));
    expect(response.headers.getSetCookie()).toEqual(['tok=a=b']);
  });
});

describe('deleteResponseCookie', () => {
  it('attaches the clearing cookie', () => {
    const response = deleteResponseCookie(Response.json({}), 'sid');
    const [header] = response.headers.getSetCookie();
    expect(header).toContain('sid=');
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Path=/');
  });
});

describe('redirectResponse', () => {
  it('defaults to 307, which preserves the request method', () => {
    // Response.redirect() would give 302 and silently downgrade a non-GET
    // follow-up to a GET, losing the body.
    expect(redirectResponse('https://host.test/done').status).toBe(307);
  });

  it('honours an explicit status', () => {
    expect(redirectResponse('https://host.test/done', 302).status).toBe(302);
  });

  it('accepts a URL object as well as a string', () => {
    const response = redirectResponse(new URL('https://host.test/done'));
    expect(response.headers.get('location')).toBe('https://host.test/done');
  });

  it('leaves the headers MUTABLE, unlike Response.redirect', () => {
    // The whole reason this helper exists.
    const spec = Response.redirect('https://host.test/done', 307);
    expect(() => spec.headers.append('set-cookie', 'x=1')).toThrow();

    const ours = redirectResponse('https://host.test/done');
    expect(() => ours.headers.append('set-cookie', 'x=1')).not.toThrow();
    expect(ours.headers.getSetCookie()).toEqual(['x=1']);
  });
});

describe('applyResponseCookies onto a 204', () => {
  it('merges without giving the 204 a body', () => {
    // Rebuilding a response means calling `new Response(body, { status })`,
    // and a 204 with a non-null body is a RangeError. The queued-cookie path
    // must therefore keep the body null all the way through.
    const scope = createRequestScope(new Request('https://host.test/x'));
    writeCookie(scope, 'planted', 'ok', { path: '/' });

    const merged = applyResponseCookies(scope, new Response(null, { status: 204 }));
    expect(merged.status).toBe(204);
    expect(merged.body).toBeNull();
    expect(merged.headers.getSetCookie()).toEqual(['planted=ok; Path=/']);
  });
});
