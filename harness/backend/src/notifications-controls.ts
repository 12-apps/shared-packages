/**
 * The SUITE's controls, not the package's.
 *
 * Split from `notifications-host.ts` when the wiring adoption pushed that file
 * past the size gate, and along the seam it already had: everything here is
 * `/__harness/**` — a route the browser drives to put the server in a state no
 * endpoint of the surface exposes. None of it is wiring, and a reader looking
 * for what this host hands `@12-apps/notifications` should not have to scroll
 * past it.
 */
import { Hono } from 'hono';

import type { OutboxLatch } from './notifications-latch';
import {
  NOTIFICATIONS_TENANT_ID,
  SHORT_PAYMENT_PERMISSIONS,
  type HarnessNotifications,
  type OutboxEntry,
} from './notifications-host';

export function harnessControls(
  surface: Pick<
    HarnessNotifications,
    'notify' | 'notifyByPermission' | 'drainPending' | 'dispatchDeliveries'
  >,
  outbox: OutboxEntry[],
  latch: OutboxLatch,
): Hono {
  const routes = new Hono();
  routes.get('/outbox', (c) => c.json({ data: { entries: outbox } }));
  // The dispatcher, addressable one notification at a time — so the suite can
  // start TWO of them against the same row and assert that only one send comes
  // out. Paired with hold/release, which is what keeps both inside the window.
  routes.post('/dispatch', async (c) => {
    await surface.dispatchDeliveries(c.req.query('id') ?? '');
    return c.json({ data: { ok: true } });
  });
  routes.post('/hold', (c) => {
    latch.hold();
    return c.json({ data: { held: true } });
  });
  routes.post('/release', (c) => {
    latch.release();
    return c.json({ data: { held: false } });
  });
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
  routes.post('/drain', async (c) => {
    // The retry sweep a host puts on a cron, reachable from the suite and from
    // the page — the delivery rows are the durable record, so this is what turns
    // a failed send into a delivered one. `take` is exposed so the suite can
    // assert the bound over real SQL rather than only against the fake.
    const take = c.req.query('take');
    return c.json({
      data: await surface.drainPending(
        Number(c.req.query('olderThanMs') ?? 0),
        take === undefined ? undefined : Number(take),
      ),
    });
  });
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

/**
 * The four channels this harness declares, and what each one has to STATE.
 *
 * Lifted out of `notificationsHost` so the wiring reads as the fixed
 * declaration it is — and so the function stays inside the size gate, which
 * the `linkLabel` line was what finally pushed it past.
 *
 * `linkLabel` (EMAIL), `defaultCountryCode` (both phone channels) and
 * `templateLanguage` (WhatsApp) are all REQUIRED for one reason: a package
 * default would be this product's answer landing in a stranger's inbox, on a
 * foreign number, or under a template registered in the wrong language.
 */
