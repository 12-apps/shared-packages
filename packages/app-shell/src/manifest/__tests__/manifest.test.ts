/**
 * The wiring-compliance suite (the report-builder shape): the manifests are
 * plain `satisfies`-checked values with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 *
 * The wire view gets BEHAVIOURAL cases beside the declarations, because it is
 * the one place this manifest is more than data: it carries the handoff
 * cookie across a response shape with no cookie field, and the failure it
 * prevents — the acceptance answering 204 with the cookie silently missing,
 * i.e. a sign-up flow that loses consent at the OAuth hop and reports success
 * — type-checks perfectly.
 */

import { describe, expect, it } from 'vitest';
import {
  assertDbMirror,
  assertEnvMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
} from '@12-apps/wiring/producer';
import type { PackageManifest } from '@12-apps/wiring';

import packageJson from '../../../package.json';
import { CONSENT_ACCEPT_PATH, CONSENT_STATUS_PATH } from '../../core/consent-wire';
import type { AppShellServerConfig } from '../../server';
import { appShellManifest } from '../index';
import { appShellServerManifest, createWireApiAppShell, serializeCookie } from '../server';

/**
 * The manifest as an ADOPTER's type sees it — `as const satisfies` narrows to
 * the literal, on which an absent optional key is a compile error rather than
 * `undefined`. Built per case: the flakiness lane refuses shared test-scope
 * bindings.
 */
function declared(): PackageManifest {
  return appShellManifest;
}

const VERSION = '2026-01-01';

function config(overrides: Partial<AppShellServerConfig> = {}): AppShellServerConfig {
  return {
    termsVersion: VERSION,
    messages: { recordFailed: 'falhou' },
    consent: {
      resolveActor: () => null,
      isCurrent: () => true,
      record: () => undefined,
    },
    ...overrides,
  } as AppShellServerConfig;
}

/** The config that plants the handoff cookie — the raw-answer case. */
function withCookie(): AppShellServerConfig {
  return config({
    consent: {
      resolveActor: () => null,
      isCurrent: () => true,
      record: () => undefined,
      cookie: {
        name: 'signup_terms',
        sign: (version) => `signed:${version}`,
        ttlMs: 60_000,
        secure: true,
      },
    },
  });
}

function routeAt(api: ReturnType<typeof createWireApiAppShell>, path: string) {
  const route = api.routes.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`the ${path} route is gone`);
  return route;
}

describe('the app-shell manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    expect(defineManifest(appShellManifest)).toBe(appShellManifest);
    expect(defineServerManifest(appShellManifest, appShellServerManifest)).toBe(
      appShellServerManifest,
    );
  });

  it('declares the consent surface and the namespace', () => {
    expect(appShellManifest.name).toBe('@12-apps/app-shell');
    expect(appShellManifest.contract).toBe(1);
    expect(appShellManifest.server).toEqual(['http']);
    expect(appShellManifest.observability).toEqual({ namespace: 'app-shell' });
  });

  it('declares no web inventory — createWebAppShell IS the shell, not a contribution', () => {
    expect(declared().web).toBeUndefined();
  });

  it('declares no db and no permissions — consent lives on the HOST row, behind public routes', () => {
    expect(declared().db).toBeUndefined();
    expect(declared().permissions).toBeUndefined();
  });

  it('declares no mcp, env, e2e, jobs or email — see the manifest narrowings', () => {
    expect(declared().mcp).toBeUndefined();
    expect(declared().env).toBeUndefined();
    expect(declared().e2e).toBeUndefined();
    expect(appShellServerManifest).not.toHaveProperty('jobs');
    expect(appShellServerManifest).not.toHaveProperty('email');
  });

  it('mirrors the (absent) db declaration and the manifest subpaths into package.json', () => {
    assertDbMirror(appShellManifest, packageJson);
    assertEnvMirror(appShellManifest, packageJson);
    assertExportsMirror(appShellManifest, packageJson);
  });
});

describe('the wire view', () => {
  it('keeps both descriptors, in mount order, and marks them public', () => {
    const api = createWireApiAppShell(config());
    expect(api.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      `GET ${CONSENT_STATUS_PATH}`,
      `POST ${CONSENT_ACCEPT_PATH}`,
    ]);
    expect(api.routes.every((route) => route.kind === 'public')).toBe(true);
    expect(api.termsVersion).toBe(VERSION);
  });

  it('answers the JSON half when no cookie is planted', async () => {
    const api = createWireApiAppShell(config());
    const answer = await routeAt(api, CONSENT_STATUS_PATH).handle({
      actor: undefined,
      params: {},
      query: {},
    });

    expect(answer).toEqual({ status: 200, body: { data: { stale: false, version: VERSION } } });
  });

  it('carries the handoff cookie onto a raw response — the failure this view exists for', async () => {
    const api = createWireApiAppShell(withCookie());
    const answer = await routeAt(api, CONSENT_ACCEPT_PATH).handle({
      actor: undefined,
      params: {},
      query: {},
    });

    expect(answer).toHaveProperty('response');
    const { response } = answer as { response: Response };
    expect(response.status).toBe(204);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`signup_terms=signed:${VERSION}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    // 204 means NO body — not `null`, which a client would parse as a value.
    expect(await response.text()).toBe('');
  });

  it('hands the host seam its header accessor and the raw request', async () => {
    const seen: { agent?: string; raw?: unknown } = {};
    const api = createWireApiAppShell(
      config({
        consent: {
          resolveActor: (request) => {
            seen.agent = request.header('user-agent');
            seen.raw = request.raw;
            return null;
          },
          isCurrent: () => true,
          record: () => undefined,
        },
      }),
    );
    const raw = new Request('https://host.test/consent/status', {
      headers: { 'user-agent': 'Firefox on Fedora' },
    });

    await routeAt(api, CONSENT_STATUS_PATH).handle({
      actor: undefined,
      params: {},
      query: {},
      request: raw,
    });

    expect(seen.agent).toBe('Firefox on Fedora');
    expect(seen.raw).toBe(raw);
  });

  it('still answers when the adapter forwarded no raw request — header is simply empty', async () => {
    const seen: { agent?: string } = {};
    const api = createWireApiAppShell(
      config({
        consent: {
          resolveActor: (request) => {
            seen.agent = request.header('user-agent');
            return null;
          },
          isCurrent: () => true,
          record: () => undefined,
        },
      }),
    );

    const answer = await routeAt(api, CONSENT_STATUS_PATH).handle({
      actor: undefined,
      params: {},
      query: {},
    });

    expect(seen.agent).toBeUndefined();
    expect(answer).toHaveProperty('status', 200);
  });

  it('serializes a non-secure, strict cookie without inventing attributes', () => {
    expect(
      serializeCookie({
        name: 'signup_terms',
        value: 'v',
        maxAge: 600,
        path: '/',
        httpOnly: false,
        sameSite: 'strict',
        secure: false,
      }),
    ).toBe('signup_terms=v; Path=/; Max-Age=600; SameSite=Strict');
  });
});
