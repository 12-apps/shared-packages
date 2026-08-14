/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   the "database" is the in-memory fake in `fake-db.ts`, built fresh per case:
   there is no real database to isolate and no state that outlives a test. The
   rules fire on the seam's method names (`seed`, `count`) and on locals the
   heuristic reads as shared. */
import { describe, expect, it } from 'vitest';

import { defineAuditVocabulary } from '../../core/vocabulary';
import { AUDIT_LOG_ORDER_BY } from '../db';
import { createAuditStore } from '../store';
import { parseAuditLogQuery } from '../wire';
import { DEFAULT_MESSAGES } from '../config';

import { fakeAuditDb } from './fake-db';

/**
 * PAGINATION OVER TIED TIMESTAMPS — a row seen twice, and a row never seen.
 *
 * `created_at` is `timestamp(3)` and takes the statement's own clock, so entries
 * written in a burst share a millisecond. An audit trail is written in bursts by
 * definition: one request that cancels an order, refunds it and closes its
 * session writes three entries inside one transaction.
 *
 * SQL guarantees NO order among rows a sort cannot distinguish, and the listing
 * fetches a page with `skip`/`take` — two statements per page view, and a
 * different statement per page. With `ORDER BY created_at DESC` alone, the
 * engine may answer page 1 and page 2 with different permutations of the same
 * tied group: the reader sees one entry twice and never sees another. On a
 * security log, "never sees another" is a row that silently does not exist for
 * whoever was reading.
 *
 * The delegate's `orderBy` used to be typed `{ createdAt: 'desc' }` — CLOSED, so
 * a tie-break could not even be expressed through the seam. It is now the
 * two-clause {@link AUDIT_LOG_ORDER_BY}, and the fake honours whatever it is
 * given: with the tie-break the pages are exact, without it they disagree.
 */
const VOCABULARY = defineAuditVocabulary({
  actions: { 'lamp.relight': { label: 'Lamp relit' } },
  resources: { lamp: { label: 'Lamp', fields: ['lumens'] } },
});

const TENANT = 'service-northern';
/** One instant, six rows — the burst. */
const BURST = new Date('2026-08-01T12:00:00.000Z');

function tiedStore() {
  const fake = fakeAuditDb();
  fake.seed(
    ...['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) => ({
      id,
      clientId: TENANT,
      createdAt: BURST,
      action: 'lamp.relight',
      resourceType: 'lamp',
      resourceId: id,
    })),
  );
  return { fake, store: createAuditStore(() => Promise.resolve(fake.db)) };
}

const query = (page: number, pageSize: number) =>
  parseAuditLogQuery(
    VOCABULARY,
    { page: String(page), pageSize: String(pageSize) },
    DEFAULT_MESSAGES,
  );

describe('paging a burst of entries written in the same millisecond', () => {
  it('shows every row exactly once across consecutive pages', async () => {
    // The failing case without the tie-break: `orderRows` in the fake rotates a
    // tied group per statement, exactly as an engine is free to, so page 2 would
    // repeat a row page 1 already showed and drop one nobody ever sees.
    const { store } = tiedStore();

    const first = await store.listPage(TENANT, query(1, 3));
    const second = await store.listPage(TENANT, query(2, 3));
    const seen = [...first.data, ...second.data].map((entry) => entry.id);

    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect([...seen].sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  });

  it('answers the same page identically when it is asked twice', async () => {
    // The other half of the same property: a reader who reloads, or a second
    // client polling, must not be shown a different slice of the same tie.
    const { store } = tiedStore();

    const once = await store.listPage(TENANT, query(1, 3));
    const twice = await store.listPage(TENANT, query(1, 3));

    expect(twice.data.map((entry) => entry.id)).toEqual(once.data.map((entry) => entry.id));
  });

  it('asks the seam for a TOTAL order, and for this one', async () => {
    // The contract, asserted at the seam rather than inferred from the rows: a
    // hand-written implementation reads this array and maps it into its own
    // ORDER BY, so the package and its host cannot come to disagree about the
    // sort. `createdAt` first, `id` as the tie-break, both descending.
    const { fake, store } = tiedStore();

    await store.listPage(TENANT, query(1, 3));

    expect(fake.orderBys).toEqual([AUDIT_LOG_ORDER_BY]);
    expect(fake.orderBys[0]).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('still orders by time first, so a tie-break cannot become the sort', async () => {
    // The tie-break is a tie-break: a newer entry outranks an older one whatever
    // their ids are. `id` is a random uuid in production, so a sort that led
    // with it would scramble the trail completely.
    const fake = fakeAuditDb();
    fake.seed(
      { id: 'zzz-old', clientId: TENANT, createdAt: new Date('2026-08-01T09:00:00.000Z') },
      { id: 'aaa-new', clientId: TENANT, createdAt: new Date('2026-08-01T18:00:00.000Z') },
    );
    const store = createAuditStore(() => Promise.resolve(fake.db));

    const page = await store.listPage(TENANT, query(1, 10));

    expect(page.data.map((entry) => entry.id)).toEqual(['aaa-new', 'zzz-old']);
  });
});
