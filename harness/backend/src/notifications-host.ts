/**
 * Everything `@12-apps/notifications` needs from a HOST, in one object (12-15).
 *
 * What is genuinely the host's, and all that is here: who is calling (a
 * header-driven session stand-in — a browser cannot have a real one), how to
 * reach a person (`contacts`, over this harness's roster), which vendors carry
 * which channel (`transports`, all four declared against ONE recording driver so
 * a send is observable instead of imaginary), the domain events (`generators` —
 * `order.paid` and friends are product vocabulary, not the package's), the plan
 * gate (`channelPolicy`) and the authorization engine behind the permission
 * fan-out (`audience`, over a real grant table). Everything else — routing,
 * delivery rows, retries, parsing, statuses, the envelope, the pt-BR copy — is
 * the package's, which is the entire claim under test.
 *
 * The `audience` directory reads a harness-owned `notification_audience` table
 * rather than driving `@12-apps/rbac`'s engine. Both queries are answered by a
 * real Postgres against real rows, which is what the fan-out's contract is about;
 * pointing it at another package's engine would make this suite fail when THAT
 * package's config shape changes, which is not the property under test.
 */
import { Hono } from 'hono';
import type { PGlite } from '@electric-sql/pglite';

import type { NotificationGenerator } from '@12-apps/notifications';
import { notificationsRouter } from '@12-apps/notifications/hono';

import { notificationsDb } from './notifications-db';

/** The mounted surface's type — inferred, so the host keeps its exact shape. */
export type HarnessNotifications = ReturnType<typeof notificationsHost>;

/** The tenant a tenant-scoped emit is stamped with. */
export const NOTIFICATIONS_TENANT_ID = 'harness';

/** A second tenant, so the plan gate has somebody to deny. */
export const NOTIFICATIONS_TENANT_FREE_ID = 'harness-free';

/** The pair the short-capture alert addresses (AND, not OR). */
export const SHORT_PAYMENT_PERMISSIONS = [
  'orders:refund',
  'reports:financial:read',
] as const;

/**
 * The people. A real host joins its identity table; this one holds the roster in
 * code, which is exactly what the `contacts` port exists to allow — and the
 * phones are what make SMS/WhatsApp reachable for some users and not others.
 */
export const NOTIFICATION_PEOPLE: readonly {
  id: string;
  email: string | null;
  phone: string | null;
}[] = [
  { id: 'owner-1', email: 'ana@harness.dev', phone: '+5531999998888' },
  // No phone: the availability probe must report SMS/WhatsApp unreachable for
  // this one, and the preferences screen must disable those toggles.
  { id: 'admin-1', email: 'otavio@harness.dev', phone: null },
  // No address at all: EMAIL is unreachable too.
  { id: 'chef-1', email: null, phone: '31988887777' },
];

const CONTACTS = new Map(NOTIFICATION_PEOPLE.map((person) => [person.id, person]));

/** The header a spec sets to act as someone else; the SPA acts as the owner. */
const ACTOR_HEADER = 'x-notifications-user';

/**
 * The host's domain events. These are the part that deliberately does NOT port:
 * `order.paid` is Future Pay's vocabulary, and a host declares its own.
 */
const GENERATORS: readonly NotificationGenerator<never>[] = [
  {
    type: 'order.paid',
    category: 'orders',
    generate: (payload: { code: string }) => ({
      title: 'Pagamento confirmado',
      body: `Pedido ${payload.code} pago.`,
      link: `/orders/${payload.code}`,
      data: { code: payload.code },
    }),
  } as NotificationGenerator<never>,
  {
    type: 'payment.short',
    category: 'payments',
    generate: (payload: { missing: string }) => ({
      title: 'Pagamento a menor',
      body: `Faltam ${payload.missing} nesta cobrança.`,
      link: '/payments',
    }),
  } as NotificationGenerator<never>,
  {
    type: 'stock.low',
    category: 'stock',
    generate: (payload: { item: string }) => ({
      title: 'Estoque baixo',
      body: `${payload.item} está acabando.`,
      link: '/stock',
    }),
  } as NotificationGenerator<never>,
];

/** One send this harness observed, as the outbox records it. */
export interface OutboxEntry {
  channel: string;
  /** A NON-identifying destination hint — an address in a log is PII. */
  destination: string;
  payload: string;
}

/** Create the one harness table this host owns (a real adopter has its own). */
export async function createNotificationHostTables(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS notification_audience (
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (client_id, user_id, permission)
    );
  `);
}

/** The grant fixture: who can act on what, at which tenant. */
const AUDIENCE_GRANTS: readonly { clientId: string; userId: string; permissions: string[] }[] = [
  // Holds BOTH — the only addressee of the short-payment alert.
  { clientId: NOTIFICATIONS_TENANT_ID, userId: 'owner-1', permissions: [...SHORT_PAYMENT_PERMISSIONS] },
  // Holds ONE of the two: under OR this user would be notified into a 403.
  { clientId: NOTIFICATIONS_TENANT_ID, userId: 'admin-1', permissions: ['orders:refund'] },
  // A candidate at this tenant whose qualifying grant lives at the OTHER one.
  { clientId: NOTIFICATIONS_TENANT_ID, userId: 'chef-1', permissions: ['stock:read'] },
  { clientId: NOTIFICATIONS_TENANT_FREE_ID, userId: 'chef-1', permissions: [...SHORT_PAYMENT_PERMISSIONS] },
];

/** Wipe + reseed everything this surface owns — the `/__harness/reset` contract. */
export async function reseedNotifications(
  pg: PGlite,
  notifications: HarnessNotifications,
): Promise<void> {
  await pg.exec(
    `TRUNCATE TABLE notification_deliveries, notifications, notification_preferences,
     push_subscriptions, notification_audience`,
  );
  notifications.outbox.length = 0;

  const params: unknown[] = [];
  const values = AUDIENCE_GRANTS.flatMap((grant) =>
    grant.permissions.map((permission) => {
      params.push(grant.clientId, grant.userId, permission);
      const base = params.length - 3;
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    }),
  ).join(', ');
  await pg.query(
    `INSERT INTO notification_audience (client_id, user_id, permission) VALUES ${values}`,
    params,
  );

  // Seeded inbox rows for the SPA, emitted through the REAL front door so the
  // page renders what the pipeline actually produces.
  const codes = ['A-1024', 'A-1025', 'A-1026'];
  for (const [index, code] of codes.entries()) {
    const { notificationId } = await notifications.notify(
      {
        type: 'order.paid',
        recipient: { userId: 'owner-1', clientId: NOTIFICATIONS_TENANT_ID },
        payload: { code },
      },
      { sync: true },
    );
    // Stamp a descending age, oldest first. `created_at` defaults to the
    // transaction clock, so three inserts inside one millisecond TIE — and a tie
    // is broken by a random uuid, which makes "newest first" (and therefore the
    // cursor pager) arbitrary rather than wrong.
    await pg.query(
      `UPDATE notifications SET created_at = NOW() - ($1 || ' minutes')::interval WHERE id = $2`,
      [String(codes.length - index), notificationId],
    );
  }
  notifications.outbox.length = 0;
}

/**
 * The one thing a test environment genuinely cannot have is a vendor at the other
 * end. Everything else stays real — the router, the preference gate, the delivery
 * rows, each channel's own PACKAGE formatter — and the send lands in this array,
 * which is what makes "it was actually sent on this channel, with this body" an
 * assertion rather than an assumption.
 */
function recorder(outbox: OutboxEntry[]) {
  const record = (channel: string, destination: string, payload: unknown): Promise<void> => {
    outbox.push({ channel, destination, payload: JSON.stringify(payload) });
    return Promise.resolve();
  };
  // All four channels declared against ONE host driver key. A real host writes
  // `driver: 'resend'` here and nothing else changes — which is the claim.
  return {
    email: { harness: () => ({ send: (to: string, message: unknown) => record('EMAIL', to, message) }) },
    sms: { harness: () => ({ send: (to: string, message: unknown) => record('SMS', to, message) }) },
    whatsapp: {
      harness: () => ({ send: (to: string, message: unknown) => record('WHATSAPP', to, message) }),
    },
    webPush: {
      harness:
        () =>
        (subscription: { endpoint: string }, payload: string): Promise<void> =>
          record('WEB_PUSH', subscription.endpoint, payload),
    },
  };
}

/** The host's authorization engine, over a real grant table. */
function audienceDirectory(pg: PGlite) {
  return {
    listCandidates: async (tenantId: string): Promise<string[]> => {
      const { rows } = await pg.query<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM notification_audience WHERE client_id = $1 ORDER BY user_id`,
        [tenantId],
      );
      return rows.map((row) => row.user_id);
    },
    getPermissions: async (userId: string, tenantId: string): Promise<string[]> => {
      // Scoped to the tenant, deliberately: a grant held elsewhere must not
      // qualify a candidate here.
      const { rows } = await pg.query<{ permission: string }>(
        `SELECT permission FROM notification_audience WHERE client_id = $1 AND user_id = $2`,
        [tenantId, userId],
      );
      return rows.map((row) => row.permission);
    },
  };
}

/**
 * The SUITE's and the browser's own endpoints, not the package's: emit an event,
 * run the retry sweep, address a fan-out, and read what the vendors received.
 * They live under `/__harness` so nothing here can be mistaken for part of the
 * published surface.
 */
function harnessControls(
  surface: Pick<HarnessNotifications, 'notify' | 'notifyByPermission' | 'drainPending'>,
  outbox: OutboxEntry[],
): Hono {
  const routes = new Hono();
  routes.get('/outbox', (c) => c.json({ data: { entries: outbox } }));
  routes.post('/emit', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      type?: string;
      userId?: string;
      clientId?: string | null;
      payload?: Record<string, unknown>;
    };
    const result = await surface.notify(
      {
        type: body.type ?? 'order.paid',
        recipient: {
          userId: body.userId ?? 'owner-1',
          ...(body.clientId === null ? {} : { clientId: body.clientId ?? NOTIFICATIONS_TENANT_ID }),
        },
        payload: body.payload ?? { code: 'A-9999' },
      },
      { sync: true },
    );
    return c.json({ data: result });
  });
  routes.post('/drain', async (c) =>
    // The retry sweep a host puts on a cron, reachable from the suite and from
    // the page — the delivery rows are the durable record, so this is what turns
    // a failed send into a delivered one.
    c.json({ data: await surface.drainPending(Number(c.req.query('olderThanMs') ?? 0)) }),
  );
  routes.post('/fan-out', async (c) =>
    c.json({
      data: await surface.notifyByPermission(
        NOTIFICATIONS_TENANT_ID,
        SHORT_PAYMENT_PERMISSIONS,
        { type: 'payment.short', payload: { missing: 'R$ 18,00' } },
      ),
    }),
  );
  return routes;
}

/** The mounted surface: the package's router behind this host's seams. */
export function notificationsHost(pg: PGlite) {
  const outbox: OutboxEntry[] = [];

  const surface = notificationsRouter({
    db: () => Promise.resolve(notificationsDb(pg)),
    generators: GENERATORS,
    contacts: {
      getContact: (userId) => {
        const person = CONTACTS.get(userId);
        return Promise.resolve(person ? { email: person.email, phone: person.phone } : null);
      },
    },
    transports: [
      { channel: 'EMAIL', driver: 'harness', appUrl: 'https://harness.test' },
      { channel: 'SMS', driver: 'harness', appUrl: 'https://harness.test' },
      { channel: 'WHATSAPP', driver: 'harness', appUrl: 'https://harness.test' },
      { channel: 'WEB_PUSH', driver: 'harness', publicKey: 'BHarnessVapidPublicKey' },
    ],
    drivers: recorder(outbox),
    // The plan gate: the free tenant pays for the inbox and nothing else, so a
    // tenant-scoped emit there DEGRADES to zero channels rather than vanishing.
    channelPolicy: (clientId, channels) =>
      clientId === NOTIFICATIONS_TENANT_FREE_ID ? [] : [...channels],
    audience: audienceDirectory(pg),
    logger: { info: () => undefined, error: () => undefined },
    resolveActor: (c) => {
      // The SPA sends no header and acts as the seeded owner; a spec that needs
      // another vantage sets one, and `anonymous` exercises the 401 path.
      const userId = c.req.header(ACTOR_HEADER) ?? 'owner-1';
      return userId === 'anonymous' ? null : { userId };
    },
  });

  return { ...surface, harnessRoutes: harnessControls(surface, outbox), outbox };
}
