/* eslint-disable test-flakiness/no-test-isolation -- the fixture is built INSIDE each `it`
   (`createHarnessBackend()`), so nothing is shared between cases; the rule reads any `const`
   inside a `describe` as describe-level and then flags ordinary method calls on it. */
import { afterEach, describe, expect, it } from 'vitest';

import { verifyRealtimeTicket } from '@12-apps/realtime/ticket';

import { createHarnessBackend, type HarnessBackend } from '../src/app';

/**
 * The subscribe surface over the REAL mount the SPA drives, out of the packed tarball.
 *
 * The question every case asks is the only one that matters at this seam: can a client be
 * served a topic the host did not resolve? A foreign tenant slug, a domain the surface never
 * registered, a qualifier smuggled onto a station the caller does not hold, a caller with no
 * identity at all.
 *
 * These are HTTP requests against `app.request()`, which reaches the same handlers a socket
 * does — a test of a hand-rolled second app would prove nothing about the one that serves the
 * SPA.
 */

const SECRET = 'harness-realtime-secret';

/** Track the one backend a case opened, so `afterEach` can close it. */
const open: { backend: HarnessBackend | null } = { backend: null };

async function backend(): Promise<HarnessBackend> {
  const created = await createHarnessBackend();
  open.backend = created;
  return created;
}

afterEach(async () => {
  const created = open.backend;
  open.backend = null;
  await created?.close();
});

function as(actor: string): RequestInit {
  return { headers: { 'x-harness-actor': actor } };
}

describe('GET the tenant stream', () => {
  it('streams SSE for a caller who may read the domain', async () => {
    const { app } = await backend();
    const response = await app.request(
      '/api/admin/loja-a/realtime?topics=kitchen,orders',
      as('owner'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('the mount dropped the stream body');
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(': connected');
    await reader.cancel();
  });

  it('relays a published hint to an open stream', async () => {
    const { app } = await backend();
    const response = await app.request('/api/admin/loja-a/realtime?topics=kitchen', as('owner'));
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no body');
    await reader.read();

    // The host's publisher stand-in: an event onto the resolved topic.
    await app.request('/__harness/realtime/publish', {
      method: 'POST',
      body: JSON.stringify({ tenantId: 'tenant-a', domain: 'kitchen', type: 'kitchen.changed' }),
    });

    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain('kitchen.changed');
    expect(frame).toContain('"topic":"tenant:tenant-a:kitchen"');
    // Identifiers only — the payload rule.
    expect(frame).toContain('"data":{}');
    await reader.cancel();
  });

  it('does NOT relay another tenant’s event to a subscribed stream', async () => {
    const { app } = await backend();
    const response = await app.request('/api/admin/loja-a/realtime?topics=kitchen', as('owner'));
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no body');
    await reader.read();

    await app.request('/__harness/realtime/publish', {
      method: 'POST',
      body: JSON.stringify({ tenantId: 'tenant-b', domain: 'kitchen', type: 'foreign.event' }),
    });
    await app.request('/__harness/realtime/publish', {
      method: 'POST',
      body: JSON.stringify({ tenantId: 'tenant-a', domain: 'kitchen', type: 'mine.event' }),
    });

    // Asserting the ORDER rather than an absence: the sink writes in publish order, so the
    // foreign publish arriving FIRST and the next frame being ours proves it was never
    // enqueued. Waiting for a non-event would need a timer.
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain('mine.event');
    expect(frame).not.toContain('foreign.event');
    await reader.cancel();
  });

  it('refuses a caller with no identity', async () => {
    const { app } = await backend();
    const response = await app.request('/api/admin/loja-a/realtime?topics=kitchen');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Não autenticado.' });
  });

  it('refuses a member of ANOTHER store — the cross-tenant probe', async () => {
    const { app } = await backend();
    // The tenant comes from the PATH and the membership from the actor, so a slug can never
    // be smuggled past the check.
    const response = await app.request('/api/admin/loja-a/realtime?topics=kitchen', as('outsider'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Sem acesso a esta loja.' });
  });

  it('refuses an unknown slug with 404, not a stream', async () => {
    const { app } = await backend();
    expect((await app.request('/api/admin/nao-existe/realtime?topics=kitchen', as('owner'))).status).toBe(404);
  });

  it('refuses a domain the caller may not read', async () => {
    const { app } = await backend();
    // The cook holds `kitchen` only.
    const response = await app.request('/api/admin/loja-a/realtime?topics=orders', as('cook'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Sem permissão para o tópico: orders.' });
  });

  it('refuses a domain the SURFACE never registered', async () => {
    const { app } = await backend();
    const response = await app.request('/api/admin/loja-a/realtime?topics=payroll', as('owner'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Tópico desconhecido: payroll.' });
  });

  it('refuses a qualifier on a domain that declares none', async () => {
    const { app } = await backend();
    // `orders` is store-wide and unqualified; its seam was never written to check one.
    const response = await app.request(
      '/api/admin/loja-a/realtime?topics=orders:some-order',
      as('owner'),
    );
    expect(response.status).toBe(400);
  });

  it('refuses a station the caller does not hold', async () => {
    const { app } = await backend();
    const response = await app.request(
      '/api/admin/loja-a/realtime?topics=kitchen:station-9',
      as('cook'),
    );
    expect(response.status).toBe(403);
  });

  it('refuses the UNQUALIFIED firehose to a station-scoped caller', async () => {
    const { app } = await backend();
    // The tenant-wide stream is the class tier by another name.
    expect((await app.request('/api/admin/loja-a/realtime?topics=kitchen', as('cook'))).status).toBe(403);
  });

  it('serves the station the caller DOES hold', async () => {
    const { app } = await backend();
    const response = await app.request(
      '/api/admin/loja-a/realtime?topics=kitchen:station-1',
      as('cook'),
    );
    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it('refuses a missing ?topics= rather than defaulting to everything', async () => {
    const { app } = await backend();
    const response = await app.request('/api/admin/loja-a/realtime', as('owner'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Tópicos inválidos.' });
  });
});

describe('POST the ticket mint', () => {
  it('signs the RESOLVED names, built from ids the host resolved', async () => {
    const { app } = await backend();
    const response = await app.request('/api/admin/loja-a/realtime/ticket?topics=kitchen', {
      method: 'POST',
      ...as('owner'),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { ticket: string; expiresInSeconds: number } };
    expect(verifyRealtimeTicket(body.data.ticket, SECRET)?.topics).toEqual([
      'tenant:tenant-a:kitchen',
    ]);
    expect(body.data.expiresInSeconds).toBe(30);
  });

  it('performs the IDENTICAL authorization the stream does', async () => {
    const { app } = await backend();
    // The two transports can never disagree about who may watch what — which is the whole
    // reason the gateway needs no authorization of its own.
    const stream = await app.request('/api/admin/loja-a/realtime?topics=orders', as('cook'));
    const ticket = await app.request('/api/admin/loja-a/realtime/ticket?topics=orders', {
      method: 'POST',
      ...as('cook'),
    });
    expect([stream.status, ticket.status]).toEqual([403, 403]);
    await stream.body?.cancel();
  });

  it('signs nothing for a member of another store', async () => {
    const { app } = await backend();
    const response = await app.request('/api/admin/loja-a/realtime/ticket?topics=kitchen', {
      method: 'POST',
      ...as('outsider'),
    });
    expect(response.status).toBe(403);
  });

  it('is not reachable by GET', async () => {
    const { app } = await backend();
    // A GET would be cacheable, prefetchable and replayable out of a history entry.
    expect(
      (await app.request('/api/admin/loja-a/realtime/ticket?topics=kitchen', as('owner'))).status,
    ).toBe(404);
  });
});

describe('the account surface', () => {
  it('builds the topic from the CALLER, with no id in the path', async () => {
    const { app } = await backend();
    const response = await app.request('/api/account/realtime/ticket?topics=notifications', {
      method: 'POST',
      ...as('cook'),
    });
    const body = (await response.json()) as { data: { ticket: string } };
    // There is nothing here a caller could point at somebody else.
    expect(verifyRealtimeTicket(body.data.ticket, SECRET)?.topics).toEqual([
      'user:user-cook:notifications',
    ]);
  });

  it('refuses an unauthenticated caller', async () => {
    const { app } = await backend();
    expect((await app.request('/api/account/realtime?topics=notifications')).status).toBe(401);
  });

  it('refuses a domain the account surface does not register', async () => {
    const { app } = await backend();
    expect(
      (await app.request('/api/account/realtime?topics=kitchen', as('cook'))).status,
    ).toBe(400);
  });
});

describe('the outbox, through the host mount', () => {
  it('holds an event until a drain publishes it', async () => {
    const { app } = await backend();
    const enqueued = await app.request('/__harness/realtime/outbox', {
      method: 'POST',
      body: JSON.stringify({ domain: 'kitchen' }),
    });
    expect(await enqueued.json()).toEqual({ pending: 1 });

    const drained = await app.request('/__harness/realtime/drain', { method: 'POST' });
    expect(await drained.json()).toMatchObject({ published: 1, failed: 0, contended: 0 });
  });

  it('commits nothing when the host write fails', async () => {
    const { app } = await backend();
    const response = await app.request('/__harness/realtime/outbox', {
      method: 'POST',
      body: JSON.stringify({ domain: 'kitchen', fail: true }),
    });
    // The event cannot exist without its cause.
    expect(await response.json()).toEqual({ pending: 0 });
  });

  it('delivers a drained event to an open stream', async () => {
    const { app } = await backend();
    const response = await app.request('/api/admin/loja-a/realtime?topics=kitchen', as('owner'));
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no body');
    await reader.read();

    await app.request('/__harness/realtime/outbox', {
      method: 'POST',
      body: JSON.stringify({ domain: 'kitchen' }),
    });
    await app.request('/__harness/realtime/drain', { method: 'POST' });

    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain('kitchen.changed');
    await reader.cancel();
  });
});
