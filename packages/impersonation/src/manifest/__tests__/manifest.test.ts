/**
 * The wiring-compliance suite (the report-builder shape): the manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 */

import { describe, expect, it } from 'vitest';
import {
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
  defineWebManifest,
} from '@12-apps/wiring/producer';
import type { PackageManifest } from '@12-apps/wiring';

import packageJson from '../../../package.json';
import { actor, testServerConfig } from '../../__tests__/fixtures';
import { impersonationManifest, impersonationPreviewManifest } from '../index';
import {
  asWireAnswer,
  createWireApiImpersonation,
  impersonationPreviewServerManifest,
  impersonationServerManifest,
  readCookie,
  serializeCookie,
} from '../server';
import { impersonationPreviewWebManifest, impersonationWebManifest } from '../web';
import { createWebImpersonation } from '../../react/create-web-impersonation';

/** The manifest as an ADOPTER's type sees it — see the audit suite for why. */
function declared(manifest: PackageManifest): PackageManifest {
  return manifest;
}

describe('the impersonation manifests', () => {
  it('pass the producer assertions, each server half against its own shared half', () => {
    expect(defineManifest(impersonationManifest)).toBe(impersonationManifest);
    expect(defineManifest(impersonationPreviewManifest)).toBe(impersonationPreviewManifest);
    expect(defineServerManifest(impersonationManifest, impersonationServerManifest)).toBe(
      impersonationServerManifest,
    );
    expect(
      defineServerManifest(impersonationPreviewManifest, impersonationPreviewServerManifest),
    ).toBe(impersonationPreviewServerManifest);
    expect(defineWebManifest(impersonationManifest, impersonationWebManifest)).toBe(
      impersonationWebManifest,
    );
    expect(
      defineWebManifest(impersonationPreviewManifest, impersonationPreviewWebManifest),
    ).toBe(impersonationPreviewWebManifest);
  });

  it('are NAMED apart, which is what keeps the two mounts from merging', () => {
    // One binding for two mounts would hand a host one mountPath for surfaces
    // that sit behind different gates — and let a version bump widen the
    // tenant mount with a platform row. Distinct names make that unsayable.
    expect(impersonationManifest.name).toBe('@12-apps/impersonation');
    expect(impersonationPreviewManifest.name).toBe('@12-apps/impersonation-preview');
  });

  it('declare the banner surface — the one this package refuses to start without', () => {
    // `web` was not narrowed here, it was simply MISSING, which is how a host
    // could adopt the server half, never learn the banner exists, and get a
    // mount whose every start fails the handshake.
    expect(impersonationManifest.web).toEqual(['surface', 'areas']);
    expect(impersonationPreviewManifest.web).toEqual(['surface']);
    expect(impersonationWebManifest.surface.create).toBe(createWebImpersonation);
    expect(impersonationPreviewWebManifest.surface.create).toBe(createWebImpersonation);
  });

  it('routes only the operator start dialog, and only in the platform area', () => {
    // The banner is per-DOCUMENT and cannot be an area row — areas are routed
    // screens, and unmounting the banner is exactly what makes the next start
    // refuse. A previewing tenant app mounts the banner and no picker, so the
    // preview manifest declares no areas at all.
    const [area] = impersonationWebManifest.areas;
    expect(area.area).toBe('super-admin');
    expect(area.routes).toEqual([{ path: 'impersonate', screen: 'dialog' }]);
    expect(impersonationPreviewWebManifest).not.toHaveProperty('areas');
  });

  it('declare the e2e world on the operator half, and no db or env anywhere', () => {
    expect(impersonationManifest.e2e).toEqual({
      entry: '@12-apps/impersonation/e2e',
      world: { factory: 'defineImpersonationWorld' },
    });
    // The session is a signed COOKIE, not a row; every deployment choice is an
    // argument; the gating permission id is the host's own.
    for (const manifest of [impersonationManifest, impersonationPreviewManifest]) {
      expect(declared(manifest).db).toBeUndefined();
      expect(declared(manifest).env).toBeUndefined();
      expect(declared(manifest).permissions).toBeUndefined();
    }
  });

  it('mirrors the manifest subpaths into package.json', () => {
    assertExportsMirror(impersonationManifest, packageJson);
  });
});

describe('the wire view of a descriptor answer', () => {
  const cookie = {
    name: 'fp_imp',
    value: 'signed-payload',
    options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 900 },
  } as const;

  it('stays `{status, body}` when there is no cookie to apply', () => {
    // Only what the JSON half cannot express takes the raw half.
    expect(asWireAnswer({ status: 200, body: { active: false } })).toEqual({
      status: 200,
      body: { active: false },
    });
  });

  it('becomes a raw Response carrying Set-Cookie when there is', () => {
    // The cookie rides the descriptor precisely because a framework-neutral
    // handler has no response object to set it on — so "the session started
    // but the cookie never left" stops being a per-adapter bug.
    const answer = asWireAnswer({ status: 201, body: { active: true }, cookie });

    expect('response' in answer).toBe(true);
    const { response } = answer as { response: Response };
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toContain('fp_imp=signed-payload');
  });

  it('serializes every attribute the package already decided', () => {
    const header = serializeCookie(cookie);
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=900');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
  });

  it('omits Secure when the host is not on https, rather than forcing it', () => {
    // `secure` is the host's argument; a serializer that always set it would
    // make the session silently unreadable over plain http in development.
    expect(serializeCookie({ ...cookie, options: { ...cookie.options, secure: false } })).not.toContain(
      'Secure',
    );
  });
});

describe('reading the session cookie off a request', () => {
  it('picks the named entry, not the whole header', () => {
    // The bug this replaces: handing the package the entire Cookie header,
    // where it expects one value, reads as "no session" every time.
    expect(readCookie('other=1; fp_imp=abc; third=2', 'fp_imp')).toBe('abc');
  });

  it('is undefined when absent, and when there is no header at all', () => {
    expect(readCookie('other=1', 'fp_imp')).toBeUndefined();
    expect(readCookie(null, 'fp_imp')).toBeUndefined();
  });

  it('does not match a cookie whose name merely ends with the one asked for', () => {
    // `xfp_imp` is a different cookie; a naive `includes` would return it.
    expect(readCookie('xfp_imp=wrong', 'fp_imp')).toBeUndefined();
  });
});

describe('the wire view, on the answers this surface exists to give', () => {
  /**
   * EVERY refusal here is THROWN — the lateral-move 403, the invalid-body 400,
   * the unknown-tenant 404, the machine-token refusal — because the route
   * bodies read as straight-line prose that way. `/hono` has always folded them
   * back into a response at its edge (`.catch(foldApiError)`), and the wire view
   * shipped without that: it answered correctly on the happy path and threw on
   * every refusal.
   *
   * That is the worse of the two failure shapes. A consumer's bridge sees an
   * exception where the contract promises a `WireRouteAnswer`, so the surface
   * whose entire purpose is refusing 500s on exactly the cases it exists for,
   * while its successes look perfect — found by adopting it, not by reading it.
   */
  /** A start the schema accepts, so the refusal under test is the one meant. */
  const VALID_START = {
    targetUserId: 'u-target',
    targetApp: 'console',
    tenantId: 't-1',
    reason: 'reproducing the reported problem',
  };

  const routeFor = (method: string, path: string) => {
    const api = createWireApiImpersonation(testServerConfig());
    const route = api.routes.find((entry) => entry.method === method && entry.path === path);
    if (!route) throw new Error(`no ${method} ${path} on the platform mount`);
    return route;
  };

  it('folds a refusal into the status and sentence the package chose', async () => {
    // A start with no reason at all: the package refuses with 400 and its own
    // `invalidBody` sentence.
    const answer = await routeFor('POST', '').handle({
      actor: actor({ isPlatformAdmin: true }),
      params: {},
      body: {},
      query: {},
    } as never);

    expect(answer).toEqual({ status: 400, body: { error: expect.any(String) } });
  });

  it('folds an authorization refusal too, rather than throwing past the bridge', async () => {
    // No platform authority: 403. Before the fold this rejected, and a host
    // bridge would have answered 500 to a caller the package refused on purpose.
    const answer = await routeFor('POST', '').handle({
      actor: actor(),
      params: {},
      body: VALID_START,
      query: {},
    } as never);

    expect(answer).toMatchObject({ status: 403 });
  });

  it('still throws what is NOT a refusal — a host bug is not a 4xx', async () => {
    // `foldApiError` rethrows anything that is not an `ImpersonationApiError`,
    // which is what keeps a broken directory port from being reported to the
    // caller as an ordinary denial.
    const base = testServerConfig();
    const api = createWireApiImpersonation({
      ...base,
      directory: {
        ...base.directory,
        findTenant: () => Promise.resolve({ id: 't-1', slug: 't-1', name: 'Tenant One' }),
        resolveTarget: () => Promise.reject(new Error('the directory is down')),
      },
    });
    const start = api.routes.find((entry) => entry.method === 'POST' && entry.path === '');

    await expect(
      start?.handle({
        actor: actor({ isPlatformAdmin: true }),
        params: {},
        body: VALID_START,
        query: {},
      } as never),
    ).rejects.toThrow('the directory is down');
  });
});
