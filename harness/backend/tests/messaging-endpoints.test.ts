/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the database IS the subject: these cases drive the PUBLISHED @12-apps/messaging
   webhook routes through the harness's own app, over the generated Prisma client
   and the package's own migration. Each case uses its own delivery body, so the
   inbox rows never collide. */
/**
 * `@12-apps/messaging` as a consumer installs it: the tarball's engine, its
 * WhatsApp adapter and its webhook pair mounted under `/api`, and its jobs bound
 * through the wiring consumer. Nothing reaches the network: the adapter's Graph
 * `fetch` is the host's in-memory fake (`messaging-host.ts`).
 */
import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import { MESSAGING_APP_SECRET, MESSAGING_VERIFY_TOKEN, MESSAGING_WEBHOOK_PATH } from '../src/messaging-host';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

/** One WhatsApp delivery, as Meta sends it: a message from a contact to a number. */
function delivery(messageId: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-harness',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5511999990000', phone_number_id: 'pn-harness' },
              contacts: [{ profile: { name: 'Ana' }, wa_id: '5511988887777' }],
              messages: [
                { from: '5511988887777', id: messageId, timestamp: '1700000000', type: 'text', text: { body: 'oi' } },
              ],
            },
          },
        ],
      },
    ],
  });
}

const sign = (raw: string, secret = MESSAGING_APP_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;

async function post(raw: string, signature: string | null) {
  const response = await backend.app.request(MESSAGING_WEBHOOK_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature === null ? {} : { 'x-hub-signature-256': signature }) },
    body: raw,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function handshake(query: string) {
  const response = await backend.app.request(`${MESSAGING_WEBHOOK_PATH}?${query}`);
  return { status: response.status, text: await response.text() };
}

async function inboxRows(): Promise<number> {
  const { rows } = await backend.pg.query<{ n: number }>('SELECT count(*)::int AS n FROM messaging_inbox_deliveries');
  return rows[0]?.n ?? -1;
}

describe('the adoption', () => {
  it('assembles a clean report with the webhook pair claimed and the three jobs bound', () => {
    const messaging = backend.hosts.messaging;
    const [entry] = messaging.report.packages;
    expect(entry?.packageName).toBe('@12-apps/messaging');
    expect(entry?.capabilities.map((capability) => capability.status)).not.toContain('unbound');
    const claimed = messaging.routes.map((r) => `${r.route.method} ${r.mountPath}${r.route.path}`);
    expect(unclaimedRoutes(messaging.routes, claimed), renderWiringReport(messaging.report)).toEqual([]);
    expect(messaging.routes).toHaveLength(2);
    expect(messaging.jobs.map((job) => job.name).sort()).toEqual([
      'messaging.process-delivery',
      'messaging.reconcile-inbox',
      'messaging.retention',
    ]);
  });
});

describe('the subscription handshake', () => {
  it('echoes the challenge as the bare body for the right verify token', async () => {
    const answer = await handshake(
      `hub.mode=subscribe&hub.verify_token=${MESSAGING_VERIFY_TOKEN}&hub.challenge=1158201444`,
    );
    expect(answer).toEqual({ status: 200, text: '1158201444' });
  });

  it('refuses a wrong verify token with 403', async () => {
    const answer = await handshake('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1158201444');
    expect(answer.status).toBe(403);
  });

  it('answers 404 for a channel nobody serves', async () => {
    const response = await backend.app.request('/api/webhooks/messaging/telegram');
    expect(response.status).toBe(404);
  });
});

describe('a WhatsApp delivery', () => {
  it('with a bad signature is 401 and stores nothing', async () => {
    const before = await inboxRows();
    const raw = delivery('wamid.bad-signature');

    expect((await post(raw, sign(raw, 'someone-elses-secret'))).status).toBe(401);
    expect((await post(raw, null)).status).toBe(401);
    expect(await inboxRows()).toBe(before);
  });

  it('with a valid HMAC is 200 and stores exactly one raw inbox row, once however often it is redelivered', async () => {
    const before = await inboxRows();
    const queuedBefore = backend.hosts.messaging.queued.length;
    const raw = delivery('wamid.valid');

    const first = await post(raw, sign(raw));
    expect(first).toEqual({ status: 200, body: { received: true, duplicate: false } });
    expect(await inboxRows()).toBe(before + 1);
    const { rows } = await backend.pg.query<{ channel: string; state: string; raw_body: string }>(
      "SELECT channel, state, raw_body FROM messaging_inbox_deliveries WHERE raw_body LIKE '%wamid.valid%'",
    );
    expect(rows).toEqual([{ channel: 'whatsapp', state: 'PENDING', raw_body: raw }]);
    // The engine queued the bound job for it, deduplicated by delivery id.
    const queued = backend.hosts.messaging.queued.slice(queuedBefore);
    expect(queued.map((job) => job.name)).toEqual(['messaging.process-delivery']);

    const again = await post(raw, sign(raw));
    expect(again).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(await inboxRows()).toBe(before + 1);
  });
});
