/**
 * The wiring-compliance suite (the report-builder shape): the manifest is a
 * plain `satisfies`-checked value with the contract as a type-only
 * devDependency, so the producer factories' runtime assertions run HERE.
 *
 * The wire view gets a BEHAVIOURAL case beside the declarations, because it
 * is the one place this manifest is more than data: it carries the device
 * hint across a request shape that has no `headers` field, and the failure it
 * prevents (every saved device coming back unnamed) type-checks perfectly.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertDbMirror,
  assertExportsMirror,
  defineManifest,
  defineServerManifest,
  defineWebManifest,
} from '@12-apps/wiring/producer';
import type { PackageManifest } from '@12-apps/wiring';
import type { WireRequest } from '@12-apps/wiring';

import packageJson from '../../../package.json';
import { CLINIC_MESSAGES } from '../../__tests__/host-copy';
import { createMemoryDb, memoryContacts, type MemoryDb } from '../../server/__tests__/memory-db';
import { notificationsManifest } from '../index';
import { createWireApiNotifications, notificationsServerManifest } from '../server';
import { notificationsWebManifest } from '../web';
import { createWebNotifications } from '../../react/create-web-notifications';

/**
 * The manifest as an ADOPTER's type sees it. `as const satisfies` narrows the
 * value to its literal, on which an absent optional key is a compile error
 * rather than `undefined` — so the widened view is what a claim about
 * absence has to be made against. Built per case: the flakiness lane refuses
 * shared test-scope bindings.
 */
function declared(): PackageManifest {
  return notificationsManifest;
}

describe('the notifications manifest', () => {
  it('passes the producer assertions — the contract is a devDependency, so the check lives here', () => {
    expect(defineManifest(notificationsManifest)).toBe(notificationsManifest);
    expect(defineServerManifest(notificationsManifest, notificationsServerManifest)).toBe(
      notificationsServerManifest,
    );
    expect(defineWebManifest(notificationsManifest, notificationsWebManifest)).toBe(
      notificationsWebManifest,
    );
  });

  it('declares the account surface, the four-model partial and the namespace', () => {
    expect(notificationsManifest.name).toBe('@12-apps/notifications');
    expect(notificationsManifest.contract).toBe(1);
    expect(notificationsManifest.server).toEqual(['http', 'jobs']);
    expect(notificationsManifest.db).toEqual({
      partial: 'prisma/notifications.prisma',
      migrations: 'prisma/migrations',
    });
    expect(notificationsManifest.observability).toEqual({ namespace: 'notifications' });
  });

  it('declares no blueprints and no email — it is the mechanism, not an author or a mailer', () => {
    // Alerts belong to whichever package raises them (they arrive through
    // `generators`), and the transports are host-supplied config.
    expect(declared().notifications).toBeUndefined();
    expect(notificationsServerManifest).not.toHaveProperty('email');
  });

  it('declares the web surface — a server host reports it out-of-scope, it is not owed an answer', () => {
    // The narrowing this replaces claimed a server host would be obliged to
    // answer for the React half. It is not: the consumer reports a capability
    // declared for the OTHER runtime as `out-of-scope`, and only an applicable
    // unanswered one is `unbound`. Declaring is what makes Bell, Panel and
    // Preferences discoverable instead of hand-duplicated per host.
    expect(notificationsManifest.web).toEqual(['surface']);
    expect(notificationsWebManifest.surface.create).toBe(createWebNotifications);
    // No areas: the bell is header chrome with no route to suggest, and where
    // preferences belongs differs per host.
    expect(notificationsWebManifest).not.toHaveProperty('areas');
  });

  it('declares the dispatch and drain cadence, so a host stops restating it', () => {
    // The wire names a bound host sees — `namespace` is prepended once at bind
    // time, and these are the two the origin host already hand-rolled, so
    // adopting is a deletion rather than a rename.
    expect(notificationsServerManifest.jobs.namespace).toBe('notifications');
    expect(Object.values(notificationsServerManifest.jobs.blueprints).map((job) => job.name)).toEqual(
      ['dispatch', 'drain'],
    );
    // The numbers that were host code: the sweep's cadence, its single-flight
    // lease, and the fast path retrying infrastructure faults only.
    const { dispatch, drain } = notificationsServerManifest.jobs.blueprints;
    expect(dispatch.attempts).toBe(3);
    expect(dispatch.backoff).toEqual({ type: 'exponential', delayMs: 10_000 });
    expect(drain.schedule).toEqual({ pattern: '*/5 * * * *' });
    expect(drain.concurrency).toBe(1);
    expect(drain.attempts).toBe(1);
    expect(drain.lease).toEqual({ ttlMs: 4 * 60_000 });
  });

  it('mirrors the db declaration and the manifest subpaths into package.json', () => {
    assertDbMirror(notificationsManifest, packageJson);
    assertExportsMirror(notificationsManifest, packageJson);
  });
});

describe('the wire view', () => {
  let db: MemoryDb;

  beforeEach(() => {
    db = createMemoryDb();
  });

  function mount(): ReturnType<typeof createWireApiNotifications> {
    return createWireApiNotifications({
      categories: ['orders'],
      messages: CLINIC_MESSAGES,
      db: () => Promise.resolve(db),
      contacts: memoryContacts({ u1: { email: 'buyer@example.com', phone: null } }),
      transports: [{ channel: 'EMAIL', linkLabel: 'Ver detalhes', driver: 'log' }],
    });
  }

  /** The one descriptor that reads a header. */
  function subscribeRoute(api: ReturnType<typeof createWireApiNotifications>) {
    const route = api.routes.find(
      (candidate) => candidate.method === 'POST' && candidate.path === '/push-subscriptions',
    );
    if (!route) throw new Error('the push-subscription route is gone');
    return route;
  }

  function request(overrides: Partial<WireRequest<never>>): WireRequest<never> {
    return {
      actor: { userId: 'u1' } as never,
      params: {},
      query: {},
      ...overrides,
    };
  }

  const SUBSCRIPTION = {
    endpoint: 'https://push.example.com/abc',
    keys: { p256dh: 'key', auth: 'auth' },
  };

  it('carries the device hint from the raw request onto the saved subscription', async () => {
    const api = mount();
    const answer = await subscribeRoute(api).handle(
      request({
        body: SUBSCRIPTION,
        request: new Request('https://host.test/push-subscriptions', {
          method: 'POST',
          headers: { 'user-agent': 'Firefox on Fedora' },
        }),
      }),
    );

    expect(answer.status).toBe(200);
    // Read the stored ROW, not `pushSubscriptions.list()` — the store's list
    // projection drops `userAgent`, so asserting through it would pass with
    // the mapping deleted and prove nothing.
    expect(db.rows.subscriptions[0]?.userAgent).toBe('Firefox on Fedora');
  });

  it('still saves the subscription when the adapter passed no raw request — unnamed, not lost', async () => {
    const api = mount();
    const answer = await subscribeRoute(api).handle(request({ body: SUBSCRIPTION }));

    expect(answer.status).toBe(200);
    expect(db.rows.subscriptions).toHaveLength(1);
    expect(db.rows.subscriptions[0]?.userAgent).toBeNull();
  });
});
