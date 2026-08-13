import { beforeEach, describe, expect, it } from 'vitest';

import { createApiNotifications, type ApiNotifications } from '../create-api-notifications';
import type { NotificationAudienceDirectory } from '../by-permission';

import { createMemoryDb, memoryContacts, type MemoryDb } from './memory-db';

/**
 * The permission fan-out's FOLD — the part the package owns: the AND, the
 * deduplication, the empty-list refusal, the per-recipient isolation and the
 * tenant stamp. The host's two queries are a fixture here; the same claims run
 * against a real seeded directory over Postgres in
 * `harness/backend/tests/notifications-fanout.test.ts`.
 */

const ALERT = {
  type: 'payment.short',
  category: 'payments',
  generate: (payload: { note: string }) => ({ title: 'Aviso', body: payload.note }),
};

const PAIR = ['orders:refund', 'reports:financial:read'] as const;

let db: MemoryDb;

/** A directory over a plain grant table: `{ [tenant]: { [user]: perms } }`. */
function directory(
  grants: Record<string, Record<string, readonly string[]>>,
): NotificationAudienceDirectory {
  return {
    listCandidates: (tenantId) => Promise.resolve(Object.keys(grants[tenantId] ?? {})),
    getPermissions: (userId, tenantId) =>
      Promise.resolve(grants[tenantId]?.[userId] ?? []),
  };
}

function mount(
  audience: NotificationAudienceDirectory,
  contacts = memoryContacts({
    'u-both': { email: 'both@example.com', phone: null },
    'u-refund': { email: 'refund@example.com', phone: null },
    'u-view': { email: 'view@example.com', phone: null },
    'u-double': { email: 'double@example.com', phone: null },
  }),
): ApiNotifications {
  return createApiNotifications({
    db: () => Promise.resolve(db),
    contacts,
    generators: [ALERT as never],
    audience,
    logger: { info: () => undefined, error: () => undefined },
  });
}

const inboxCount = (userId: string): number =>
  db.rows.notifications.filter((row) => row.userId === userId).length;

beforeEach(() => {
  db = createMemoryDb();
});

describe('notifyByPermission', () => {
  it('notifies only the holders of ALL the named permissions', async () => {
    // The decisive AND case: each of these users genuinely holds one of the
    // pair. Under OR, `u-view` would be told to fix something they cannot and
    // `u-refund` would be sent to a page they cannot open.
    const api = mount(
      directory({
        't-1': {
          'u-both': PAIR,
          'u-refund': ['orders:refund'],
          'u-view': ['reports:financial:read'],
        },
      }),
    );

    const result = await api.notifyByPermission('t-1', PAIR, {
      type: 'payment.short',
      payload: { note: 'faltam R$ 18,00' },
    });

    expect(result.notified).toEqual(['u-both']);
    expect(result.skipped.map((skip) => skip.userId).sort()).toEqual(['u-refund', 'u-view']);
    expect(result.skipped.every((skip) => skip.reason === 'missing-permission')).toBe(true);
    expect(inboxCount('u-both')).toBe(1);
    expect(inboxCount('u-refund')).toBe(0);
    expect(inboxCount('u-view')).toBe(0);
  });

  it('accepts a permission SET as well as a list from the host engine', async () => {
    const api = mount({
      listCandidates: () => Promise.resolve(['u-both']),
      getPermissions: () => Promise.resolve(new Set(PAIR)),
    });
    const result = await api.notifyByPermission('t-1', PAIR, {
      type: 'payment.short',
      payload: { note: 'ok' },
    });
    expect(result.notified).toEqual(['u-both']);
  });

  it('notifies a duplicated candidate exactly once', async () => {
    // Two grants must not become two e-mails, however the host's query answers.
    const api = mount({
      listCandidates: () => Promise.resolve(['u-double', 'u-double']),
      getPermissions: () => Promise.resolve(PAIR),
    });

    const result = await api.notifyByPermission('t-1', PAIR, {
      type: 'payment.short',
      payload: { note: 'ok' },
    });

    expect(result.notified).toEqual(['u-double']);
    expect(inboxCount('u-double')).toBe(1);
  });

  it('stamps the inbox row with the tenant it was sent for', async () => {
    const api = mount(directory({ 't-9': { 'u-both': PAIR } }));
    await api.notifyByPermission('t-9', PAIR, {
      type: 'payment.short',
      payload: { note: 'ok' },
    });
    expect(db.rows.notifications[0]).toMatchObject({ clientId: 't-9', category: 'payments' });
  });

  it('is quiet — not an error — when nobody at the tenant holds the pair', async () => {
    const api = mount(directory({ 't-1': { 'u-view': ['reports:financial:read'] } }));
    const result = await api.notifyByPermission('t-1', PAIR, {
      type: 'payment.short',
      payload: { note: 'ok' },
    });
    expect(result).toEqual({
      notified: [],
      skipped: [{ userId: 'u-view', reason: 'missing-permission' }],
    });
    expect(db.rows.notifications).toHaveLength(0);
  });

  it('refuses an empty permission list rather than fanning out to the tenant', async () => {
    const api = mount(directory({ 't-1': { 'u-both': PAIR } }));
    await expect(
      api.notifyByPermission('t-1', [], { type: 'payment.short', payload: { note: 'x' } }),
    ).rejects.toThrow(/must be non-empty/);
    expect(db.rows.notifications).toHaveLength(0);
  });

  it('isolates one bad recipient from the rest, and reports why', async () => {
    // `u-ghost` holds the pair but the host cannot identify them, so `notify`
    // throws — and the two who CAN be reached still are.
    const api = mount(
      directory({ 't-1': { 'u-both': PAIR, 'u-ghost': PAIR, 'u-double': PAIR } }),
    );

    const result = await api.notifyByPermission('t-1', PAIR, {
      type: 'payment.short',
      payload: { note: 'ok' },
    });

    expect(result.notified).toEqual(['u-both', 'u-double']);
    expect(result.skipped).toEqual([{ userId: 'u-ghost', reason: 'dispatch-failed' }]);
  });

  it('distinguishes "nobody holds it" from "every dispatch failed" in the log', async () => {
    const errors: string[] = [];
    const infos: string[] = [];
    const api = createApiNotifications({
      db: () => Promise.resolve(db),
      contacts: memoryContacts({}),
      generators: [ALERT as never],
      audience: directory({ 't-1': { 'u-ghost': PAIR } }),
      logger: {
        info: (message) => infos.push(message),
        error: (message) => errors.push(message),
      },
    });

    await api.notifyByPermission('t-1', PAIR, {
      type: 'payment.short',
      payload: { note: 'ok' },
    });

    // Both outcomes leave `notified` empty; keying on that alone would file an
    // outage under "this tenant is not configured".
    expect(errors.join('\n')).toMatch(/could not be reached/);
    expect(infos.join('\n')).not.toMatch(/no recipient at client/);
  });

  it('rejects loudly when the host configured no audience directory', async () => {
    const api = createApiNotifications({
      db: () => Promise.resolve(db),
      contacts: memoryContacts({}),
      logger: { info: () => undefined, error: () => undefined },
    });
    await expect(
      api.notifyByPermission('t-1', PAIR, { type: 'payment.short', payload: {} }),
    ).rejects.toThrow(/needs an `audience` directory/);
  });
});
