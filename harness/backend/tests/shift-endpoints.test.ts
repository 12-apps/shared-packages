/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the database IS the subject: these cases drive the PUBLISHED @12-apps/shift
   routes through the harness's own app, over a real Postgres. Each case resets
   to the seeded fixture first. */
/**
 * `@12-apps/shift` as a CONSUMER gets it: the published route descriptors,
 * mounted by a host with its OWN staff vocabulary, its own desks and its own
 * wire shape, answering over PGlite through the package's own migrations.
 *
 * Every rule below already has a unit suite upstream, against the in-memory
 * driver. What these assert is the half a package cannot test alone — whether
 * the rules survive the round trip through a real store, and specifically
 * through the one table the package does NOT ship.
 *
 * That table is the reason this adoption is interesting. `ShiftTransaction`
 * asks a host to create, check and end resource claims, and names the unique
 * index they must carry, while owning no model for any of it: WHAT a shift
 * claims is host domain. So the exclusivity rule is enforced by a constraint
 * the PACKAGE named and the HOST created, and nothing upstream can run that.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { renderWiringReport, unclaimedRoutes } from '@12-apps/wiring/consumer';

import { createHarnessBackend, type HarnessBackend } from '../src/app';
import {
  SHIFT_COPY,
  SHIFT_MOUNT_PATH,
  SHIFT_TENANT_B_ID,
  SHIFT_TENANT_ID,
  SHIFT_USER_HEADER,
  shiftSweep,
} from '../src/shift-host';

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

interface WireShift {
  id: string;
  userId: string;
  kind: string;
  startedAt: string;
  endedAt: string | null;
  endedReason: string | null;
  endedBy: string | null;
  deskId: string | null;
  deskAssignmentId: string | null;
}

/** Drive the surface as a given seeded user, in a given library. */
function as(userId: string, tenantId: string = SHIFT_TENANT_ID) {
  const base = `/api/admin/${tenantId}/shifts`;
  const headers = { [SHIFT_USER_HEADER]: userId, 'content-type': 'application/json' };
  return {
    open: (body: Record<string, unknown>) =>
      backend.app.request(base, { method: 'POST', headers, body: JSON.stringify(body) }),
    close: (shiftId: string, mode: 'own' | 'force') =>
      backend.app.request(`${base}/${shiftId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ mode }),
      }),
    list: (query = '') => backend.app.request(`${base}${query}`, { headers }),
  };
}

/**
 * The shift out of the package's own `{ data }` envelope.
 *
 * The envelope is the PACKAGE's (`ok()` in its http entry); what is inside it
 * is entirely this host's, via `serialize`. Both halves are asserted below —
 * the envelope here, once, and the host shape in the first case.
 */
async function shiftFrom(response: Response): Promise<WireShift> {
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { data: WireShift };
  return payload.data;
}

/** A list page, likewise unwrapped. */
async function pageFrom(
  response: Response,
): Promise<{ items: WireShift[]; nextCursor: string | null }> {
  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    data: { items: WireShift[]; nextCursor: string | null };
  };
  return payload.data;
}

describe('opening a shift', () => {
  it('answers the HOST shape, not the package record', async () => {
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk' }));

    // `deskId` / `endedBy` are this host's field names and the dates are ISO
    // strings: `serialize` is required with no default precisely because the
    // wire fields are host vocabulary. A pass-through would have `resourceId`
    // and a Date here.
    expect(Object.keys(shift).sort()).toEqual(
      [
        'deskAssignmentId',
        'deskId',
        'endedAt',
        'endedBy',
        'endedReason',
        'id',
        'kind',
        'startedAt',
        'userId',
      ].sort(),
    );
    expect(shift.userId).toBe('ana');
    expect(shift.kind).toBe('desk');
    expect(shift.endedAt).toBeNull();
    expect(new Date(shift.startedAt).toISOString()).toBe(shift.startedAt);
  });

  it('takes the user from the caller and never from the body', async () => {
    // The package's own comment on this route: a body that named its own
    // subject would make the host's own-target check a formality the request
    // supplies both sides of. So a body naming somebody else is simply ignored.
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk', userId: 'bruno' }));
    expect(shift.userId).toBe('ana');
  });

  it('refuses a kind this library does not work in, in the host words', async () => {
    // `kinds` has no default upstream — the package removed its own two-value
    // union so an adopter's vocabulary would be its own. `kitchen` is the
    // ORIGIN host's kind, and it is not a kind here.
    const response = await as('ana').open({ kind: 'kitchen' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: SHIFT_COPY.unknownKind });
  });

  it('refuses a second open shift for the same person', async () => {
    await shiftFrom(await as('ana').open({ kind: 'desk' }));
    const second = await as('ana').open({ kind: 'stacks' });

    // 409 via `shifts_open_client_user_key`, the package's partial unique index
    // — and the store's `isUniqueViolation` had to recognise it BY NAME, which
    // is why the host's own index kept the package's naming too.
    expect(second.status).toBe(409);
  });

  it('lets the same person open a shift in another library', async () => {
    await shiftFrom(await as('ana').open({ kind: 'desk' }));
    const elsewhere = await as('ana', SHIFT_TENANT_B_ID).open({ kind: 'desk' });
    expect(elsewhere.status).toBe(200);
  });

  it('answers 401 with no caller at all', async () => {
    const response = await backend.app.request(`/api/admin/${SHIFT_TENANT_ID}/shifts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'desk' }),
    });
    expect(response.status).toBe(401);
  });
});

describe('claiming a desk', () => {
  it('records the claim and copies the snapshot onto the shift', async () => {
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk', deskId: 'desk-front' }));
    expect(shift.deskId).toBe('desk-front');
    expect(shift.deskAssignmentId).not.toBeNull();

    // The ledger row is the HOST's, in a table the package ships no model for.
    const { rows } = await backend.pg.query<{ user_id: string; valid_to: Date | null }>(
      `SELECT user_id, valid_to FROM resource_assignments
       WHERE client_id = $1 AND resource_type = 'desk' AND resource_id = 'desk-front'`,
      [SHIFT_TENANT_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe('ana');
    expect(rows[0]?.valid_to).toBeNull();
  });

  it('refuses a desk this library does not have, in the host words', async () => {
    // `fromBody` is the host's resolver and it throws the host's own sentence;
    // the package documents that such a throw flows out of the handler
    // untouched, exactly like a guard's refusal.
    const response = await as('ana').open({ kind: 'desk', deskId: 'desk-b' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: SHIFT_COPY.unknownDesk });
  });

  it('refuses an exclusive desk somebody else is already at', async () => {
    await shiftFrom(await as('ana').open({ kind: 'desk', deskId: 'desk-front' }));
    const contested = await as('bruno').open({ kind: 'desk', deskId: 'desk-front' });

    // The whole reason the ledger exists. Enforced by
    // `resource_assignments_active_unique_idx` — a partial unique index the
    // PACKAGE names in `ShiftUniqueConstraint` and the HOST creates.
    expect(contested.status).toBe(409);
  });

  it('lets two people share a desk that is not exclusive', async () => {
    // `exclusive` comes off the host's catalog, never off the request: a caller
    // able to declare its own claim non-exclusive would opt out of the rule.
    await shiftFrom(await as('ana').open({ kind: 'stacks', deskId: 'trolley' }));
    const second = await as('bruno').open({ kind: 'stacks', deskId: 'trolley' });
    expect(second.status).toBe(200);
  });

  it('frees the desk when the shift closes, and keeps the snapshot', async () => {
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk', deskId: 'desk-front' }));
    const closed = await shiftFrom(await as('ana').close(shift.id, 'own'));

    // The claim ends; the shift keeps saying which desk it was — a closed shift
    // is history, and history that forgot its desk would be unreadable.
    expect(closed.deskId).toBe('desk-front');
    const { rows } = await backend.pg.query<{ valid_to: Date | null }>(
      `SELECT valid_to FROM resource_assignments WHERE client_id = $1 AND resource_id = 'desk-front'`,
      [SHIFT_TENANT_ID],
    );
    expect(rows[0]?.valid_to).not.toBeNull();

    const reclaimed = await as('bruno').open({ kind: 'desk', deskId: 'desk-front' });
    expect(reclaimed.status).toBe(200);
  });
});

describe('closing a shift', () => {
  it('records who closed it and why, for an own close', async () => {
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk' }));
    const closed = await shiftFrom(await as('ana').close(shift.id, 'own'));
    expect(closed.endedReason).toBe('user');
    expect(closed.endedBy).toBe('ana');
    expect(closed.endedAt).not.toBeNull();
  });

  it('records a supervisor close as the supervisor, not the worker', async () => {
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk' }));
    const closed = await shiftFrom(await as('chefe').close(shift.id, 'force'));
    expect(closed.endedReason).toBe('supervisor');
    expect(closed.endedBy).toBe('chefe');
    expect(closed.userId).toBe('ana');
  });

  it('refuses an own close of somebody else shift', async () => {
    // The two modes are explicit and never inferred from whose shift the id
    // names — the package's own comment: a manager who mistyped an id must not
    // silently force-close a stranger's shift under their OWN-shift permission.
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk' }));
    const response = await as('bruno').close(shift.id, 'own');
    expect(response.status).toBe(403);
  });

  it('refuses a second close', async () => {
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk' }));
    await shiftFrom(await as('ana').close(shift.id, 'own'));
    const again = await as('ana').close(shift.id, 'own');
    expect(again.status).toBe(409);
  });

  it('answers 404 for a shift in another library', async () => {
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk' }));
    const response = await as('ana', SHIFT_TENANT_B_ID).close(shift.id, 'force');
    // Not 403: telling a caller a shift exists but belongs to another library
    // is itself a fact about that library's roster.
    expect(response.status).toBe(404);
  });

  it('freezes the record once it is closed', async () => {
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk' }));
    await shiftFrom(await as('ana').close(shift.id, 'own'));

    // The package's trigger, reached from below the surface: a closed shift is
    // a finished work record, and no host write may edit it afterwards. That
    // is what makes the 409 above a refusal rather than a race — even a caller
    // holding the connection cannot reopen it.
    await expect(
      backend.pg.query('UPDATE shifts SET ended_at = NULL WHERE id = $1', [shift.id]),
    ).rejects.toThrow(/immutable/i);
  });
});

describe('reading the roster and the history', () => {
  it('lists who is on duty now, and narrows by kind', async () => {
    await shiftFrom(await as('ana').open({ kind: 'desk' }));
    await shiftFrom(await as('bruno').open({ kind: 'stacks' }));
    const closed = await shiftFrom(await as('cida').open({ kind: 'desk' }));
    await shiftFrom(await as('cida').close(closed.id, 'own'));

    const roster = await pageFrom(await as('ana').list('?open=true'));
    expect(roster.items.map((item) => item.userId).sort()).toEqual(['ana', 'bruno']);
    // The roster is bounded by the size of a floor, so the package answers it
    // with no cursor at all rather than a page that could hide half a shift.
    expect(roster.nextCursor).toBeNull();

    const desks = await pageFrom(await as('ana').list('?open=true&kind=desk'));
    expect(desks.items.map((item) => item.userId)).toEqual(['ana']);
  });

  it('pages the history newest first, without repeating or skipping a row', async () => {
    const opened: string[] = [];
    for (const user of ['ana', 'bruno', 'cida', 'dora', 'elis']) {
      const shift = await shiftFrom(await as(user).open({ kind: 'desk' }));
      await shiftFrom(await as(user).close(shift.id, 'own'));
      opened.push(shift.id);
    }

    const first = await pageFrom(await as('ana').list('?limit=2'));
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(first.items[1]?.id);

    const second = await pageFrom(await as('ana').list(`?limit=2&cursor=${first.nextCursor}`));

    // The keyset is the assertion. These five open inside the same few
    // milliseconds, so `started_at` alone ties — a page ordered on it without
    // the id tiebreak repeats a row here, which reads as data loss.
    const seen = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual([...opened].reverse().slice(0, 4));
  });

  it('rejects a cursor that is not in this library history', async () => {
    // The package's in-memory driver throws INVALID_SHIFT rather than starting
    // from the top, and a store that silently restarted the page would hide a
    // client paging through a filter it no longer matches.
    const response = await as('ana').list('?cursor=not-a-shift');
    expect(response.status).toBe(400);
  });

  it('shows one library nothing of another', async () => {
    await shiftFrom(await as('ana').open({ kind: 'desk' }));
    const other = await pageFrom(await as('ana', SHIFT_TENANT_B_ID).list('?open=true'));
    expect(other.items).toEqual([]);
  });
});

describe('the audit seam', () => {
  it('writes a before/after pair for the open and the close', async () => {
    const shift = await shiftFrom(await as('ana').open({ kind: 'desk' }));
    await shiftFrom(await as('ana').close(shift.id, 'own'));

    const { rows } = await backend.pg.query<{
      action: string;
      actor_user_id: string | null;
      resource_id: string;
    }>(
      `SELECT action, actor_user_id, resource_id FROM shift_audits
       WHERE client_id = $1 ORDER BY id`,
      [SHIFT_TENANT_ID],
    );

    // `writeAudit` runs INSIDE the package's transaction, which is the property
    // worth having: a shift that opened without its trail, or a trail without
    // its shift, would both be a partial commit rather than a missing feature.
    expect(rows.map((row) => row.action)).toEqual(['shift.start', 'shift.end']);
    expect(rows.every((row) => row.resource_id === shift.id)).toBe(true);
    expect(rows.map((row) => row.actor_user_id)).toEqual(['ana', 'ana']);
  });
});

describe('the overdue sweep', () => {
  it('closes what is past ITS tenant window and leaves the other alone', async () => {
    const north = await shiftFrom(await as('ana').open({ kind: 'desk' }));
    const river = await shiftFrom(
      await as('beatriz', SHIFT_TENANT_B_ID).open({ kind: 'desk' }),
    );

    // The window is per TENANT, and that is the whole point of the seam: the
    // sweep is cross-tenant, so it has to ask each branch how long a shift of
    // its own may run. Driving the case through the two windows rather than
    // through a backdated clock also makes it deterministic — nothing here
    // depends on when the test ran, and the package refuses a `startedAt` more
    // than 24 hours old anyway.
    const result = await backend.shift.service.autoCloseOverdue({
      // Derived from the row rather than from a clock, so the case is decided
      // entirely by data. A second past the north shift's own start is past a
      // one-millisecond window and nowhere near a sixteen-hour one.
      detectedAt: new Date(new Date(north.startedAt).getTime() + 1000),
      maxDurationMsForTenant: async (clientId) =>
        clientId === SHIFT_TENANT_ID ? 1 : 16 * 60 * 60 * 1000,
    });

    expect(result.closed.map((shift) => shift.id)).toEqual([north.id]);
    expect(result.failures).toEqual([]);

    // The neighbour's shift is untouched, which is the half a single-tenant
    // sweep could not tell apart from "nothing was overdue".
    const neighbour = await pageFrom(await as('beatriz', SHIFT_TENANT_B_ID).list('?open=true'));
    expect(neighbour.items.map((item) => item.id)).toEqual([river.id]);
    expect(await pageFrom(await as('ana').list('?open=true'))).toMatchObject({ items: [] });

    const closed = await backend.pg.query<{ ended_reason: string; ended_by_user_id: string | null }>(
      'SELECT ended_reason, ended_by_user_id FROM shifts WHERE id = $1',
      [north.id],
    );
    // `auto` is the one end reason that carries no closer, and the package's
    // own CHECK constraint is what allows the NULL only for it.
    expect(closed.rows[0]?.ended_reason).toBe('auto');
    expect(closed.rows[0]?.ended_by_user_id).toBeNull();
  });
});

describe('adopted through @12-apps/wiring, not by calling the factory', () => {
  it("binds the package's OWN sweep blueprint — cadence, lease and all", () => {
    // The package moved these numbers into the blueprint on purpose: "every one
    // of those numbers is a claim about THIS package's domain — how often
    // overdue shifts should be swept, how long one sweep may hold the
    // single-flight name — so they belong here, declared once." The origin host
    // had been restating them in its own `defineJob`, and a harness that drives
    // `service.autoCloseOverdue` by hand repeats that in the one place that
    // exists to catch it.
    const sweep = backend.shift.jobs.find((job) => job.name === 'shift.auto-close');

    expect(sweep).toBeDefined();
    expect(sweep?.schedule).toEqual({ pattern: '*/15 * * * *' });
    // The first `lease` the contract shipped. The package's instruction for a
    // host that cannot honour one is explicit — decline the jobs binding rather
    // than run the sweep unfenced — so binding it is a claim this host makes.
    expect(sweep?.lease).toEqual({ ttlMs: 30 * 60 * 1000 });
    // A missed sweep is retried by the next tick, not by the queue.
    expect(sweep?.attempts).toBe(1);
  });

  it('runs the bound handler, not merely its metadata', async () => {
    // A harness could carry every number above in a report and never execute a
    // line of the blueprint. This drives the sweep THROUGH it: the host's own
    // duration policy is closed over the dep, and what runs is the package's
    // `handle`.
    const north = await shiftFrom(await as('ana').open({ kind: 'desk' }));
    shiftSweep.detectedAt = new Date(new Date(north.startedAt).getTime() + 1000);
    shiftSweep.maxDurationMsForTenant = async (clientId) =>
      clientId === SHIFT_TENANT_ID ? 1 : 16 * 60 * 60 * 1000;

    const sweep = backend.shift.jobs.find((job) => job.name === 'shift.auto-close');
    await sweep?.handle(undefined as never, { logger: console } as never);

    expect(await pageFrom(await as('ana').list('?open=true'))).toMatchObject({ items: [] });
  });

  it('accounts for every capability, with none unanswered', () => {
    const statuses = new Map(
      backend.shift.report.packages[0]?.capabilities.map((entry) => [entry.kind, entry.status]),
    );

    expect(statuses.get('http')).toBe('bound');
    expect(statuses.get('jobs')).toBe('bound');
    // Mandatory, and the manifest gives the reason in one line: "a sweep that
    // fails files under `shift`, not nowhere." `createApiShift` takes no logger
    // argument, so the BINDER is the only thing that can supply one.
    expect(statuses.get('observability')).toBe('bound');
    expect(statuses.get('db')).toBe('collected');
    expect([...statuses.values()]).not.toContain('unanswered');
  });

  it('names a descriptor this host forgot to claim', () => {
    const { routes } = backend.shift;
    const allButOne = routes
      .slice(1)
      .map((mounted) => `${mounted.route.method} ${SHIFT_MOUNT_PATH}${mounted.route.path}`);

    const missing = unclaimedRoutes(routes, allButOne);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.route.path).toBe(routes[0]?.route.path);
  });

  it('renders a report naming the mount', () => {
    expect(renderWiringReport(backend.shift.report)).toContain(SHIFT_MOUNT_PATH);
  });
});
