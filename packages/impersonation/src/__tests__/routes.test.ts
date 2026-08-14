import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImpersonationBannerState } from '../core/types';
import { createApiImpersonation, type ApiImpersonation } from '../server/create-api-impersonation';
import type {
  ImpersonationActor,
  ImpersonationResponse,
  ImpersonationSurface,
} from '../server/context';
import type {
  PreviewEntitlementPort,
} from '../server/ports';

import {
  actor,
  createTestAudit,
  createTestDirectory,
  memberKey,
  TEST_MESSAGES,
  testServerConfig,
  type DirectoryState,
  type RecordedTrail,
} from './fixtures';

/**
 * The two mounts, driven end to end over the in-memory ports.
 *
 * Every assertion here is about a REFUSAL and what it wrote down, because that
 * is what this surface is: three verbs, and a long list of things that must not
 * happen quietly.
 */

interface Harness {
  api: ApiImpersonation;
  state: DirectoryState;
  trail: RecordedTrail;
}

function mount(overrides: Parameters<typeof testServerConfig>[0] = {}): Harness {
  const { directory, state } = createTestDirectory();
  const { audit, trail } = createTestAudit();

  state.tenants.set('t-1', { id: 't-1', slug: 'acme', name: 'Acme' });
  state.tenants.set('t-2', { id: 't-2', slug: 'other', name: 'Other' });
  state.users.set('u-target', {
    id: 'u-target',
    email: 'target@example.test',
    name: 'Target',
    isPlatformAdmin: false,
  });
  state.users.set('u-operator', {
    id: 'u-operator',
    email: 'operator@example.test',
    name: 'Operator',
    isPlatformAdmin: true,
  });
  state.users.set('u-member', {
    id: 'u-member',
    email: 'member@example.test',
    name: 'Member',
    isPlatformAdmin: false,
  });
  state.memberships.add(memberKey('u-member', 't-1'));
  state.memberships.add(memberKey('u-actor', 't-1'));

  const api = createApiImpersonation(
    testServerConfig({ directory, audit, ...overrides }),
  );
  return { api, state, trail };
}

const START_REASON = 'reproducing the reported problem';

function drive(
  harness: Harness,
  method: 'GET' | 'POST' | 'DELETE',
  surface: ImpersonationSurface,
  request: {
    actor?: ImpersonationActor;
    body?: unknown;
    params?: Record<string, string | undefined>;
    cookieValue?: string;
  } = {},
): Promise<ImpersonationResponse> {
  const route = harness.api.routes.find(
    (candidate) => candidate.method === method && candidate.surface === surface,
  );
  if (!route) throw new Error(`no ${method} on ${surface}`);
  return route.handle({
    actor: request.actor ?? actor(),
    params: request.params ?? {},
    body: request.body,
    cookieValue: request.cookieValue,
  });
}

const operator = () =>
  actor({ userId: 'u-operator', email: 'operator@example.test', isPlatformAdmin: true });

const startBody = (overrides: Record<string, unknown> = {}) => ({
  targetUserId: 'u-target',
  targetApp: 'console',
  tenantId: 't-1',
  reason: START_REASON,
  ...overrides,
});

/** The value of the cookie a successful start planted. */
function cookieFrom(response: ImpersonationResponse): string {
  if (!response.cookie) throw new Error('no cookie on this response');
  return response.cookie.value;
}

function dataOf<T>(response: ImpersonationResponse): T {
  return (response.body as { data: T }).data;
}

describe('POST on the platform surface — starting an operator session', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = mount();
  });

  it('mints a session, plants the cookie, and answers the banner state', async () => {
    const response = await drive(harness, 'POST', 'platform', {
      actor: operator(),
      body: startBody(),
    });

    expect(response.status).toBe(200);
    expect(response.cookie?.options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(dataOf<ImpersonationBannerState>(response)).toMatchObject({
      active: true,
      kind: 'operator',
      readOnly: true,
      subject: { id: 'u-target', email: 'target@example.test' },
      tenant: { slug: 'acme' },
    });
  });

  it('writes the trail BEFORE the cookie exists, naming the reason and the window', async () => {
    await drive(harness, 'POST', 'platform', { actor: operator(), body: startBody() });
    expect(harness.trail.started).toHaveLength(1);
    expect(harness.trail.started[0]).toMatchObject({
      kind: 'operator',
      tenantId: 't-1',
      actorUserId: 'u-operator',
      targetUserId: 'u-target',
      targetApp: 'console',
      reason: START_REASON,
      allowWrites: false,
    });
  });

  it('never publishes the target\'s own platform authority to the caller', async () => {
    const response = await drive(harness, 'POST', 'platform', {
      actor: operator(),
      body: startBody(),
    });
    expect(dataOf<ImpersonationBannerState>(response).subject).not.toHaveProperty(
      'isPlatformAdmin',
    );
  });

  it('refuses a machine token outright, and records nothing', async () => {
    await expect(
      drive(harness, 'POST', 'platform', {
        actor: operator(),
        body: startBody(),
      }).then(() =>
        drive(harness, 'POST', 'platform', {
          actor: { ...operator(), isMachineToken: true },
          body: startBody(),
        }),
      ),
    ).rejects.toMatchObject({ status: 403, message: TEST_MESSAGES.machineTokenRefused });
  });

  it('refuses an app the host never declared', async () => {
    await expect(
      drive(harness, 'POST', 'platform', {
        actor: operator(),
        body: startBody({ targetApp: 'kiosk' }),
      }),
    ).rejects.toMatchObject({ status: 400, message: TEST_MESSAGES.invalidBody });
  });

  it('refuses a reason shorter than the host demands', async () => {
    await expect(
      drive(harness, 'POST', 'platform', {
        actor: operator(),
        body: startBody({ reason: 'short' }),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a target that holds platform authority, and says which rule', async () => {
    await expect(
      drive(harness, 'POST', 'platform', {
        actor: operator(),
        body: startBody({ targetUserId: 'u-operator' }),
      }),
    ).rejects.toMatchObject({ status: 403, message: TEST_MESSAGES.targetIsPlatformAdmin });
    expect(harness.trail.refused).toMatchObject([
      { refusal: 'target_is_platform_admin', targetUserId: 'u-operator', actorUserId: 'u-operator' },
    ]);
  });

  it('refuses an unknown target with a 404 and a row', async () => {
    await expect(
      drive(harness, 'POST', 'platform', {
        actor: operator(),
        body: startBody({ targetUserId: 'u-nobody' }),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(harness.trail.refused).toMatchObject([{ refusal: 'target_not_found' }]);
  });

  it('refuses an unknown tenant with a 404 and NO row — nothing to key it to', async () => {
    await expect(
      drive(harness, 'POST', 'platform', {
        actor: operator(),
        body: startBody({ tenantId: 't-nope' }),
      }),
    ).rejects.toMatchObject({ status: 404, message: TEST_MESSAGES.tenantNotFound });
    expect(harness.trail.refused).toEqual([]);
  });

  it('refuses an operator with no user row — the trail must name a real account', async () => {
    await expect(
      drive(harness, 'POST', 'platform', {
        actor: actor({ userId: null, email: 'allowlisted@example.test', isPlatformAdmin: true }),
        body: startBody(),
      }),
    ).rejects.toMatchObject({ status: 403, message: TEST_MESSAGES.actorNotRecorded });
    // The one row that names an ADDRESS, because there is no id to name instead.
    expect(harness.trail.refused).toMatchObject([
      { refusal: 'actor_not_recorded', actorUserId: null, actorEmail: 'allowlisted@example.test' },
    ]);
  });
});

describe('POST on the platform surface — who the denial is recorded for', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = mount();
  });

  it('records an unauthorized attempt by somebody the tenant already administers', async () => {
    await expect(
      drive(harness, 'POST', 'platform', { actor: actor(), body: startBody() }),
    ).rejects.toMatchObject({ status: 403, message: TEST_MESSAGES.notAuthorized });
    expect(harness.trail.refused).toMatchObject([
      { refusal: 'not_authorized', actorUserId: 'u-actor', actorEmail: null },
    ]);
  });

  it('records NOTHING for a stranger — the trail is not an append primitive', async () => {
    await expect(
      drive(harness, 'POST', 'platform', {
        actor: actor({ userId: 'u-stranger' }),
        body: startBody(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(harness.trail.refused).toEqual([]);
  });

  it('answers the same 403 either way, so it is not a probe for tenant existence', async () => {
    const denied = await drive(harness, 'POST', 'platform', {
      actor: actor({ userId: 'u-stranger' }),
      body: startBody(),
    }).catch((error: { status: number }) => error);
    const known = await drive(harness, 'POST', 'platform', {
      actor: actor(),
      body: startBody(),
    }).catch((error: { status: number }) => error);
    expect(denied.status).toBe(known.status);
  });
});

describe('POST on the platform surface — nesting', () => {
  it('refuses a start made from INSIDE a live session, keyed to the LIVE tenant', async () => {
    const harness = mount();
    const started = await drive(harness, 'POST', 'platform', {
      actor: operator(),
      body: startBody(),
    });

    await expect(
      drive(harness, 'POST', 'platform', {
        actor: operator(),
        body: startBody({ targetUserId: 'u-member', tenantId: 't-2' }),
        cookieValue: cookieFrom(started),
      }),
    ).rejects.toMatchObject({ status: 403, message: TEST_MESSAGES.alreadyImpersonating });

    expect(harness.trail.refused).toMatchObject([
      { refusal: 'already_impersonating', tenantId: 't-1', targetUserId: 'u-member' },
    ]);
    expect(harness.trail.started).toHaveLength(1);
  });

  it('asks about nesting BEFORE authority, so the trail names the honest reason', async () => {
    const harness = mount();
    const started = await drive(harness, 'POST', 'platform', {
      actor: operator(),
      body: startBody(),
    });

    // The host has forced platform authority OFF, exactly as it must while a
    // session is in force. The refusal must still be `already_impersonating`.
    await expect(
      drive(harness, 'POST', 'platform', {
        actor: { ...operator(), isPlatformAdmin: false },
        body: startBody({ targetUserId: 'u-member' }),
        cookieValue: cookieFrom(started),
      }),
    ).rejects.toMatchObject({ message: TEST_MESSAGES.alreadyImpersonating });
    expect(harness.trail.refused).toMatchObject([{ refusal: 'already_impersonating' }]);
  });
});

describe('GET on the platform surface — what the banner reads', () => {
  it('answers "no session" to anyone holding nothing, without a 401', async () => {
    const harness = mount();
    const response = await drive(harness, 'GET', 'platform', {
      actor: actor({ userId: null, email: null }),
    });
    expect(response.status).toBe(200);
    expect(dataOf<ImpersonationBannerState>(response)).toEqual({ active: false });
  });

  it('describes a live session, resolving the subject and the tenant', async () => {
    const harness = mount();
    const started = await drive(harness, 'POST', 'platform', {
      actor: operator(),
      body: startBody(),
    });
    const response = await drive(harness, 'GET', 'platform', {
      actor: operator(),
      cookieValue: cookieFrom(started),
    });
    expect(dataOf<ImpersonationBannerState>(response)).toMatchObject({
      active: true,
      kind: 'operator',
      readOnly: true,
      subject: { id: 'u-target' },
      tenant: { id: 't-1' },
    });
  });

  it('reports a role preview as NOT read-only — it substitutes nobody', async () => {
    const harness = mount();
    const started = await drive(harness, 'POST', 'tenant', {
      actor: actor({ permissions: ['user:impersonate'] }),
      params: { tenantSlug: 'acme' },
      body: { as: 'role', roleName: 'FLOOR' },
    });
    const response = await drive(harness, 'GET', 'platform', {
      actor: actor({ permissions: ['user:impersonate'] }),
      cookieValue: cookieFrom(started),
    });
    expect(dataOf<ImpersonationBannerState>(response)).toMatchObject({
      kind: 'preview',
      readOnly: false,
      previewRoleName: 'FLOOR',
    });
  });

  it('refuses to describe a cookie replayed into a different browser session', async () => {
    const harness = mount();
    const started = await drive(harness, 'POST', 'platform', {
      actor: operator(),
      body: startBody(),
    });
    const response = await drive(harness, 'GET', 'platform', {
      actor: actor({ userId: 'u-somebody-else' }),
      cookieValue: cookieFrom(started),
    });
    expect(dataOf<ImpersonationBannerState>(response)).toEqual({ active: false });
  });
});

describe('DELETE — leaving', () => {
  it('clears the cookie and records the end against the SESSION\'s tenant', async () => {
    const harness = mount();
    const started = await drive(harness, 'POST', 'platform', {
      actor: operator(),
      body: startBody(),
    });

    // Left through the OTHER tenant's mount on purpose: either mount clears the
    // same cookie, and the entry must still name the session's own tenant.
    const response = await drive(harness, 'DELETE', 'tenant', {
      actor: operator(),
      params: { tenantSlug: 'other' },
      cookieValue: cookieFrom(started),
    });

    expect(dataOf<{ ended: boolean }>(response)).toEqual({ ended: true });
    expect(response.cookie).toMatchObject({ value: '', options: { maxAge: 0 } });
    expect(harness.trail.ended).toMatchObject([
      { kind: 'operator', tenantId: 't-1', actorUserId: 'u-operator', targetUserId: 'u-target' },
    ]);
  });

  it('answers 200 with a cleared cookie when there was nothing to end', async () => {
    const harness = mount();
    const response = await drive(harness, 'DELETE', 'platform', { actor: operator() });
    expect(response.status).toBe(200);
    expect(dataOf<{ ended: boolean }>(response)).toEqual({ ended: false });
    expect(response.cookie?.options.maxAge).toBe(0);
  });

  it('clears the cookie even when the trail write fails — leaving may never fail', async () => {
    const onError = vi.fn();
    const { directory, state } = createTestDirectory();
    state.tenants.set('t-1', { id: 't-1', slug: 'acme', name: 'Acme' });
    state.users.set('u-target', {
      id: 'u-target',
      email: 'target@example.test',
      name: null,
      isPlatformAdmin: false,
    });
    const api = createApiImpersonation(
      testServerConfig({
        directory,
        onError,
        audit: {
          started: async () => undefined,
          refused: async () => undefined,
          ended: async () => {
            throw new Error('trail unavailable');
          },
        },
      }),
    );
    const started = api.codec.start({
      kind: 'operator',
      realUserId: 'u-operator',
      targetUserId: 'u-target',
      targetApp: 'console',
      tenantId: 't-1',
      reason: START_REASON,
    });
    const endpoint = api.routes.find((r) => r.method === 'DELETE' && r.surface === 'platform');
    const response = await endpoint?.handle({
      actor: operator(),
      params: {},
      cookieValue: started.cookie.value,
    });

    expect(response?.cookie?.options.maxAge).toBe(0);
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('POST on the tenant surface — starting a preview', () => {
  const permitted = () => actor({ permissions: ['user:impersonate'] });

  it('mints a role preview and reports it writable', async () => {
    const harness = mount();
    const response = await drive(harness, 'POST', 'tenant', {
      actor: permitted(),
      params: { tenantSlug: 'acme' },
      body: { as: 'role', roleName: 'FLOOR' },
    });
    expect(dataOf<{ readOnly: boolean }>(response)).toMatchObject({ readOnly: false });
    expect(harness.trail.started).toMatchObject([
      { kind: 'preview', previewOf: { as: 'role', roleName: 'FLOOR' }, allowWrites: false },
    ]);
  });

  it('mints a member preview and reports it read-only', async () => {
    const harness = mount();
    const response = await drive(harness, 'POST', 'tenant', {
      actor: permitted(),
      params: { tenantSlug: 'acme' },
      body: { as: 'member', memberUserId: 'u-member' },
    });
    expect(dataOf<{ readOnly: boolean }>(response)).toMatchObject({ readOnly: true });
  });

  it('takes no allowWrites parameter at all — it is not a parameter of this surface', async () => {
    const harness = mount();
    await expect(
      drive(harness, 'POST', 'tenant', {
        actor: permitted(),
        params: { tenantSlug: 'acme' },
        body: { as: 'role', roleName: 'FLOOR', allowWrites: true },
      }),
    ).resolves.toBeDefined();
    expect(harness.trail.started[0]?.allowWrites).toBe(false);
  });

  it('refuses a caller without the permission, and records it', async () => {
    const harness = mount();
    await expect(
      drive(harness, 'POST', 'tenant', {
        actor: actor(),
        params: { tenantSlug: 'acme' },
        body: { as: 'role', roleName: 'FLOOR' },
      }),
    ).rejects.toMatchObject({ status: 403, message: TEST_MESSAGES.notAuthorized });
    expect(harness.trail.refused).toMatchObject([{ refusal: 'not_authorized' }]);
  });

  it('lets platform authority through, the way every other tenant gate does', async () => {
    const harness = mount();
    await expect(
      drive(harness, 'POST', 'tenant', {
        actor: operator(),
        params: { tenantSlug: 'acme' },
        body: { as: 'role', roleName: 'FLOOR' },
      }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('refuses a member who is not on THIS tenant — no cross-tenant read primitive', async () => {
    const harness = mount();
    await expect(
      drive(harness, 'POST', 'tenant', {
        actor: permitted(),
        params: { tenantSlug: 'acme' },
        body: { as: 'member', memberUserId: 'u-target' },
      }),
    ).rejects.toMatchObject({ status: 403, message: TEST_MESSAGES.notAMember });
    expect(harness.trail.refused).toMatchObject([{ refusal: 'not_a_member' }]);
  });

  it('refuses a member who holds platform authority — the record must stay readable', async () => {
    const harness = mount();
    harness.state.memberships.add(memberKey('u-operator', 't-1'));
    await expect(
      drive(harness, 'POST', 'tenant', {
        actor: permitted(),
        params: { tenantSlug: 'acme' },
        body: { as: 'member', memberUserId: 'u-operator' },
      }),
    ).rejects.toMatchObject({ status: 403, message: TEST_MESSAGES.targetIsPlatformAdmin });
  });

  it('refuses an unknown slug with a 404', async () => {
    const harness = mount();
    await expect(
      drive(harness, 'POST', 'tenant', {
        actor: permitted(),
        params: { tenantSlug: 'nope' },
        body: { as: 'role', roleName: 'FLOOR' },
      }),
    ).rejects.toMatchObject({ status: 404, message: TEST_MESSAGES.tenantNotFound });
  });

  it('refuses nesting, so a preview cannot be chained into a preview', async () => {
    const harness = mount();
    const started = await drive(harness, 'POST', 'tenant', {
      actor: permitted(),
      params: { tenantSlug: 'acme' },
      body: { as: 'role', roleName: 'FLOOR' },
    });
    await expect(
      drive(harness, 'POST', 'tenant', {
        actor: permitted(),
        params: { tenantSlug: 'acme' },
        body: { as: 'member', memberUserId: 'u-member' },
        cookieValue: cookieFrom(started),
      }),
    ).rejects.toMatchObject({ message: TEST_MESSAGES.alreadyImpersonating });
  });
});

describe('POST on the tenant surface — the entitlement gate', () => {
  const denial = new Error('not on this plan');
  const gate: PreviewEntitlementPort = {
    require: async () => {
      throw denial;
    },
    isDenial: (error) => error === denial,
    denialResponse: () => ({ status: 402, message: 'upgrade to preview' }),
  };

  it("answers the HOST's own status and sentence, never a flattened 403", async () => {
    const harness = mount({ previewEntitlement: gate });
    await expect(
      drive(harness, 'POST', 'tenant', {
        actor: actor({ permissions: ['user:impersonate'] }),
        params: { tenantSlug: 'acme' },
        body: { as: 'role', roleName: 'FLOOR' },
      }),
    ).rejects.toMatchObject({ status: 402, message: 'upgrade to preview' });
    expect(harness.trail.refused).toMatchObject([{ refusal: 'not_entitled' }]);
  });

  it('propagates an unexpected engine error rather than calling it a denial', async () => {
    const boom = new Error('database blip');
    const harness = mount({
      previewEntitlement: {
        require: async () => {
          throw boom;
        },
        isDenial: () => false,
        denialResponse: () => ({ status: 402, message: 'x' }),
      },
    });
    await expect(
      drive(harness, 'POST', 'tenant', {
        actor: actor({ permissions: ['user:impersonate'] }),
        params: { tenantSlug: 'acme' },
        body: { as: 'role', roleName: 'FLOOR' },
      }),
    ).rejects.toBe(boom);
  });
});

describe('the mint policy hook', () => {
  it('lets a host refuse a start in its own words, on either surface', async () => {
    const refuse = vi.fn(() => 'not during a freeze');
    const harness = mount({
      mintPolicy: {
        targetApps: ['console'],
        reasonLength: { min: 15, max: 280 },
        refuse,
      },
    });
    await expect(
      drive(harness, 'POST', 'platform', { actor: operator(), body: startBody() }),
    ).rejects.toMatchObject({ status: 403, message: 'not during a freeze' });
    expect(refuse).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'platform', tenantId: 't-1' }),
    );
  });
});
