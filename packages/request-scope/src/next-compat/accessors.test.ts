import { describe, expect, it } from 'vitest';

import { createRequestScope, runWithRequestScope } from '../core/scope';
import { cookies, headers } from './index';

const scopeFor = (cookie?: string): ReturnType<typeof createRequestScope> =>
  createRequestScope(
    new Request('https://host.test/x', {
      headers: { 'x-trace': 'abc', ...(cookie ? { cookie } : {}) },
    }),
  );

describe('next/headers-compatible accessors', () => {
  it('headers() hands back the incoming request headers', async () => {
    await runWithRequestScope(scopeFor(), async () => {
      expect((await headers()).get('x-trace')).toBe('abc');
    });
  });

  it('cookies().get returns the { name, value } shape, not a bare string', async () => {
    await runWithRequestScope(scopeFor('sid=abc'), async () => {
      expect((await cookies()).get('sid')).toEqual({ name: 'sid', value: 'abc' });
    });
  });

  it('cookies().get is undefined for an absent cookie', async () => {
    await runWithRequestScope(scopeFor('sid=abc'), async () => {
      expect((await cookies()).get('nope')).toBeUndefined();
    });
  });

  it('cookies().has separates an empty value from an absent one', async () => {
    await runWithRequestScope(scopeFor('empty='), async () => {
      const jar = await cookies();
      expect(jar.has('empty')).toBe(true);
      expect(jar.get('empty')).toEqual({ name: 'empty', value: '' });
      expect(jar.has('nope')).toBe(false);
    });
  });

  it('a get after a set observes the new value, as Next’s jar did', async () => {
    const scope = scopeFor('sid=old');
    await runWithRequestScope(scope, async () => {
      const jar = await cookies();
      jar.set('sid', 'new');
      expect(jar.get('sid')).toEqual({ name: 'sid', value: 'new' });
    });
    expect(scope.setCookies).toHaveLength(1);
  });

  it('a get after a delete observes the absence', async () => {
    const scope = scopeFor('sid=old');
    await runWithRequestScope(scope, async () => {
      const jar = await cookies();
      jar.delete('sid');
      expect(jar.get('sid')).toBeUndefined();
      expect(jar.has('sid')).toBe(false);
    });
    expect(scope.setCookies[0]).toContain('Max-Age=0');
  });

  it('BOTH accessors throw outside a request scope', async () => {
    // The behaviour callers deliberately catch to mean "no incoming request".
    await expect(headers()).rejects.toThrow(/No request scope is open/);
    await expect(cookies()).rejects.toThrow(/No request scope is open/);
  });
});
