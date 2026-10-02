/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the database IS the subject: these cases drive the PUBLISHED @12-apps/chat
   routes through the harness's own app, over the generated Prisma client and
   the package's own migration. Each case resets to no threads first. */
/**
 * `@12-apps/chat` as a CONSUMER gets it: the published route descriptors,
 * mounted by a host with its OWN roster, its own role labels and its own
 * session, answering over PGlite through the client `prisma generate` built
 * from the package's partial.
 *
 * Every rule below already has a unit suite upstream, against an in-memory
 * fake of `ChatDb`. What these assert is the half a package cannot test alone:
 * that a REAL generated client satisfies the structural seam (the compound
 * unique keys, the `orderBy` pair, the nullable `quick_key` filter), and that
 * the host's `authorize` is the only thing deciding who is in a thread.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { EN_US_CHAT_SERVER_COPY } from '@12-apps/chat/server';
import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import {
  CHAT_MOUNT_PATH,
  CHAT_PEOPLE,
  CHAT_PERSON_COOKIE,
  CHAT_TENANT_ID,
} from '../src/chat-host';

let backend: HarnessBackend;

beforeAll(async () => {
  backend = await createHarnessBackend();
}, 120_000);

afterAll(async () => {
  await backend.close();
});

beforeEach(async () => {
  const reset = await backend.app.request('/__harness/reset', { method: 'POST' });
  expect(reset.status).toBe(204);
});

interface WireMessage {
  id: string;
  role: string;
  label: string;
  mine: boolean;
  body: string;
  createdAt: string;
}

interface WireThread {
  thread: { me: { role: string; label: string }; canWrite: boolean; quickReplies: unknown[] };
  messages: WireMessage[];
  unread: number;
}

/** Drive one request's thread as a given person, through the host's session cookie. */
function as(person: string | null, requestId = 'request-open') {
  const base = `/api/admin/${CHAT_TENANT_ID}/requests/${requestId}/chat`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (person !== null) headers['cookie'] = `${CHAT_PERSON_COOKIE}=${person}`;
  return {
    load: () => backend.app.request(base, { headers }),
    send: (body: Record<string, unknown>) =>
      backend.app.request(`${base}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    read: (upTo: string) =>
      backend.app.request(`${base}/read`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ upTo }),
      }),
  };
}

/** The `X` of the package's `{ data: X }` envelope, after checking the status. */
async function dataOf<T>(response: Response, status: number): Promise<T> {
  expect(response.status).toBe(status);
  const payload = (await response.json()) as { data: T };
  expect(Object.keys(payload)).toEqual(['data']);
  return payload.data;
}

describe('a conversation between two roles', () => {
  it('delivers a message from one role to another, labelled by role only', async () => {
    const sent = await dataOf<{ message: WireMessage }>(
      await as(CHAT_PEOPLE.requester).send({ body: 'Is the visit still on for today?' }),
      201,
    );
    expect(sent.message).toMatchObject({ role: 'requester', label: 'Requester', mine: true });

    const seen = await dataOf<WireThread>(await as(CHAT_PEOPLE.agent).load(), 200);
    expect(seen.thread.me).toEqual({ role: 'agent', label: 'Field agent' });
    expect(seen.messages).toHaveLength(1);
    // No person id crosses the wire — the package's whole point. The keys are
    // pinned so a field carrying `authorId` would be a red line here.
    expect(Object.keys(seen.messages[0] as object).sort()).toEqual(
      ['body', 'createdAt', 'id', 'label', 'mine', 'role'].sort(),
    );
    expect(seen.messages[0]).toMatchObject({
      label: 'Requester',
      mine: false,
      body: 'Is the visit still on for today?',
    });
  });

  it('counts what the other side has not read, and clears it on read', async () => {
    await as(CHAT_PEOPLE.requester).send({ body: 'First question.' });
    await as(CHAT_PEOPLE.requester).send({ body: 'Second question.' });

    const before = await dataOf<WireThread>(await as(CHAT_PEOPLE.agent).load(), 200);
    expect(before.unread).toBe(2);
    // The author's own messages are never unread to them.
    expect((await dataOf<WireThread>(await as(CHAT_PEOPLE.requester).load(), 200)).unread).toBe(0);

    const newest = before.messages.at(-1)?.createdAt ?? '';
    const read = await dataOf<{ unread: number }>(await as(CHAT_PEOPLE.agent).read(newest), 200);
    expect(read.unread).toBe(0);
  });

  it('sends a quick reply as the host words it', async () => {
    const sent = await dataOf<{ message: WireMessage }>(
      await as(CHAT_PEOPLE.agent).send({ quickReply: 'on-site' }),
      201,
    );
    expect(sent.message.body).toBe('I am on site.');
  });

  it('lets a shared role speak and read as one', async () => {
    const [first, second] = CHAT_PEOPLE.team;
    await as(first).send({ body: 'We are looking into it.' });

    const seen = await dataOf<WireThread>(await as(second).load(), 200);
    expect(seen.messages[0]).toMatchObject({ label: 'Support team', mine: true });
  });
});

describe('the contact filter, per role', () => {
  it('refuses contact info from the role that blocks it, in the host words', async () => {
    const refused = await as(CHAT_PEOPLE.agent).send({ body: 'Call me on 555 123 4567' });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({
      error: 'contact_info',
      message: EN_US_CHAT_SERVER_COPY.contactInfo,
    });

    // Nothing was stored, so the other side sees an empty thread.
    expect((await dataOf<WireThread>(await as(CHAT_PEOPLE.requester).load(), 200)).messages).toEqual(
      [],
    );
    // `onRefused` runs in the background; the host's moderation view gets it.
    await vi.waitFor(() =>
      expect(backend.hosts.chat.refusals).toEqual([
        expect.objectContaining({ role: 'agent', authorId: CHAT_PEOPLE.agent, kinds: ['phone'] }),
      ]),
    );
  });

  it('reads the role\'s own recent free text with a draft, through the real client', async () => {
    // Free text twice, so the cross-message query (the nullable quick_key
    // filter and the `orderBy` pair) runs against the generated client.
    const agent = as(CHAT_PEOPLE.agent);
    expect((await agent.send({ body: 'On site soon' })).status).toBe(201);
    expect((await agent.send({ body: '98765' })).status).toBe(201);
    const split = await agent.send({ body: '4321' });
    expect(split.status).toBe(422);
    expect(await split.json()).toEqual({ error: 'contact_info', message: EN_US_CHAT_SERVER_COPY.contactInfo });
    // An unrelated line after it is not poisoned by the number before it.
    expect((await agent.send({ body: 'Ringing the bell now' })).status).toBe(201);
  });

  it('lets a role that blocks nothing send the same line', async () => {
    const sent = await as(CHAT_PEOPLE.requester).send({ body: 'Call me on 555 123 4567' });
    expect(sent.status).toBe(201);
  });
});

describe('who is in a thread is the host decision', () => {
  it('answers 401 with no session at all', async () => {
    expect((await as(null).load()).status).toBe(401);
  });

  it('answers the package 404 to a person who is not a party', async () => {
    const response = await as(CHAT_PEOPLE.stranger).load();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'not_found',
      message: EN_US_CHAT_SERVER_COPY.notFound,
    });
  });

  it('answers 404 for a request this host does not have', async () => {
    expect((await as(CHAT_PEOPLE.requester, 'request-unknown').load()).status).toBe(404);
  });

  it('leaves the parties of a closed request read-only, and the team able to answer', async () => {
    const thread = await dataOf<WireThread>(
      await as(CHAT_PEOPLE.requester, 'request-done').load(),
      200,
    );
    expect(thread.thread.canWrite).toBe(false);

    const refused = await as(CHAT_PEOPLE.requester, 'request-done').send({ body: 'One more thing.' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'closed' });

    const [member] = CHAT_PEOPLE.team;
    expect((await as(member, 'request-done').send({ body: 'Closing this out.' })).status).toBe(201);
  });
});

describe('the wiring report', () => {
  it('accounts for every capability, with none unanswered', () => {
    const entries = backend.hosts.chat.report.packages[0]?.capabilities ?? [];
    const statusOf = (kind: string, runtime?: string) =>
      entries.find((entry) => entry.kind === kind && entry.runtime === runtime)?.status;

    expect(backend.hosts.chat.report.packages[0]?.packageName).toBe('@12-apps/chat');
    expect(statusOf('http')).toBe('bound');
    expect(statusOf('observability')).toBe('bound');
    expect(statusOf('db')).toBe('collected');
    // The thread SCREEN is declared for two other runtimes, and a server host
    // reports each as answered elsewhere — the web one by harness/frontend.
    expect(statusOf('surface', 'web')).toBe('out-of-scope');
    expect(statusOf('surface', 'native')).toBe('out-of-scope');
    expect(entries.map((entry) => entry.status)).not.toContain('unbound');
  });

  it('names a descriptor this host forgot to claim', () => {
    const { routes } = backend.hosts.chat;
    expect(routes).toHaveLength(3);
    const allButOne = routes
      .slice(1)
      .map((mounted) => `${mounted.route.method} ${CHAT_MOUNT_PATH}${mounted.route.path}`);

    const missing = unclaimedRoutes(routes, allButOne);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.route.path).toBe(routes[0]?.route.path);
  });

  it('renders a report naming the mount', () => {
    expect(renderWiringReport(backend.hosts.chat.report)).toContain(CHAT_MOUNT_PATH);
  });
});
