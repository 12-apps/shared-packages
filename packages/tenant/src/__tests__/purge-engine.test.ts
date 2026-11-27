import { describe, expect, it, vi } from 'vitest';

import { AFTER, DAY_MS, PURGE_AT, purgeHost } from './purge-fixtures';

/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-test-isolation, test-flakiness/no-long-text-match, test-flakiness/no-global-state-mutation --
   The engine's SQL on real Postgres (PGlite) is the subject. Each case boots its own in-memory database.
   The long strings are SQL sent to the database, not text matched against; the counters are a fake host's own state. */

vi.setConfig({ testTimeout: 60_000 });

/**
 * FUT-5636: the purge engine on real Postgres, case by case against the
 * contract (C1…C15, I1…I14). The host is a clinic network, so nothing here
 * leans on the host the engine was extracted from.
 */

async function ready() {
  const host = purgeHost();
  await host.migrate();
  return host;
}

const writes = (statements: readonly string[]) => statements.filter((sql) => /^\s*(INSERT|UPDATE|DELETE)/iu.test(sql));

describe('C1, C12, C13, C14, C15: the happy path', () => {
  it('flips first, erases and keeps by the config, stamps before zeroing, audits once, mirrors, within the budget', async () => {
    const host = await ready();
    await host.seed('org-a', { images: ['img/org-a/cover.webp', 'img/shared.webp', 'img/own.webp'], balance: 700 });
    await host.seed('org-b', { images: ['img/org-b/cover.webp'] });
    await host.pg.query(`INSERT INTO photos (org_id, image_key) VALUES ('org-b', 'img/shared.webp'), ('org-b', 'img/org-a/stolen.webp')`);
    await host.closing('org-a');

    const { value, statements, transactions } = await host.counted(() => host.engine.run('org-a', { now: AFTER }));
    expect(value).toBe('purged');

    // I2: the descendants read, then the CAS; the closing row is read after it.
    const cas = statements.findIndex((sql) => /^UPDATE orgs SET status/u.test(sql));
    const rowRead = statements.findIndex((sql) => /FROM tenant_closings WHERE tenant_id/u.test(sql));
    expect(cas).toBe(1);
    expect(rowRead).toBe(cas + 1);
    // I6: the stamp precedes every balance statement.
    const stamp = statements.findIndex((sql) => /^UPDATE "tenant_closings" SET "purged_at"/u.test(sql));
    const money = statements.findIndex((sql) => /accounts|ledger/u.test(sql));
    expect(money).toBeGreaterThan(stamp);
    // C14: three transactions (flip, owed objects, stamp); the erase runs in none.
    expect(transactions).toBe(3);

    // §3, as the engine issues it: tree 1 + Tx-A 4 (CAS, row, profile, revoke) + collect 1 + held 1 + record 2
    // + erase 12 (4 erase, staff 1 child + 2, vendors 0 + 2, 3 strips) + Tx-C 3 (stamp, mirror, audit) + the host's zeroing 2.
    expect(statements).toHaveLength(1 + 4 + 1 + 1 + 2 + 12 + 3 + 2);

    // C1: status, profile, credentials; the erased tables are empty of the tenant.
    expect((await host.pg.query(`SELECT status, city FROM orgs WHERE id = 'org-a'`)).rows).toEqual([{ status: 'SHUT', city: null }]);
    expect(await host.count(`devices WHERE org_id = 'org-a' AND revoked_at IS NOT NULL`)).toBe(1);
    expect(await host.count(`patients WHERE org_id = 'org-a'`)).toBe(0);
    expect(await host.count(`photos WHERE org_id = 'org-a'`)).toBe(0);
    expect(await host.count(`grants WHERE scope = 'org-a'`)).toBe(0);
    // The kind discriminator is bound: the person's setting with the same owner stays.
    expect((await host.pg.query(`SELECT owner_kind FROM settings WHERE owner_ref = 'org-a'`)).rows).toEqual([{ owner_kind: 'PERSON' }]);
    // I4: the kept tables keep every row; I5: the other org is untouched.
    expect(await host.count(`visits WHERE org_id = 'org-a'`)).toBe(1);
    expect(await host.count(`rosters WHERE org_id = 'org-a'`)).toBe(1);
    expect(await host.count(`lots WHERE org_id = 'org-a' AND vendor_id IS NOT NULL`)).toBe(1);
    expect(await host.count(`patients WHERE org_id = 'org-b'`)).toBe(2);
    expect(await host.count(`devices WHERE org_id = 'org-b' AND revoked_at IS NULL`)).toBe(1);

    // C12: held rows kept and stripped, their children erased; every other row erased; strips over all rows.
    expect((await host.pg.query(`SELECT user_id, active FROM staff WHERE org_id = 'org-a'`)).rows).toEqual([{ user_id: 'u-held', active: false }]);
    expect(await host.count(`staff_roles r JOIN staff s ON s.id = r.staff_id WHERE s.org_id = 'org-a'`)).toBe(0);
    expect(await host.count(`staff_roles r JOIN staff s ON s.id = r.staff_id WHERE s.org_id = 'org-b'`)).toBe(2);
    expect((await host.pg.query(`SELECT name, contact FROM vendors WHERE org_id = 'org-a'`)).rows).toEqual([{ name: 'Acme', contact: null }]);
    expect((await host.pg.query(`SELECT note, author FROM reports WHERE org_id = 'org-a'`)).rows).toEqual([{ note: null, author: 'Removed person' }]);
    expect(await host.count(`report_lines l JOIN reports r ON r.id = l.report_id WHERE r.org_id = 'org-a' AND l.photo_key IS NULL`)).toBe(1);
    expect(await host.count(`report_lines l JOIN reports r ON r.id = l.report_id WHERE r.org_id = 'org-b' AND l.photo_key IS NOT NULL`)).toBe(1);

    // C13 / I6: one adjustment per account that held money, balance zero.
    expect((await host.pg.query(`SELECT amount FROM ledger WHERE org_id = 'org-a'`)).rows).toEqual([{ amount: -700 }]);
    expect(await host.count(`accounts WHERE org_id = 'org-a' AND balance > 0`)).toBe(0);
    expect(host.knobs.zeroCalls).toBe(1);

    // I7: one audit line, with the erased tables in order.
    const audit = await host.pg.query<{ action: string; after: { erased: string[]; purgeAt: string } }>(`SELECT action, after FROM audit_lines WHERE org_id = 'org-a'`);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.action).toBe('clinic_close.purged');
    expect(audit.rows[0]?.after).toMatchObject({ purgeAt: PURGE_AT.toISOString(), erased: ['patients', 'staff', 'vendors', 'photos', 'settings', 'grants'] });

    // C7 / C15 / I9: owed = the scoped key and the legacy key no other org holds; heldElsewhere asked ONCE with every legacy key.
    expect(host.knobs.heldCalls).toEqual([['img/shared.webp', 'img/own.webp']]);
    const owed = ['img/org-a/cover.webp', 'img/own.webp'];
    const fresh = await host.pg.query(`SELECT image_keys_owed, purged_at FROM tenant_closings WHERE tenant_id = 'org-a'`);
    const legacy = await host.pg.query(`SELECT image_keys_owed, purged_at FROM legacy_closings WHERE org_id = 'org-a'`);
    expect(fresh.rows).toEqual([{ image_keys_owed: owed, purged_at: AFTER }]);
    expect(legacy.rows).toEqual(fresh.rows);
    // I8: nothing deleted before the image pass.
    for (const key of owed) expect(host.objects.has(key), key).toBe(true);
  });

  it('C8, I8: the image pass keeps a key storage cannot vouch for, drops it once every member is gone, mirrored, idempotent', async () => {
    const host = await ready();
    await host.seed('org-a', { images: ['img/org-a/one.webp', 'img/org-a/two.webp', 'img/org-a/six.webp'] });
    await host.seed('org-b', { images: ['img/org-b/cover.webp'] });
    await host.closing('org-a');
    expect(await host.engine.run('org-a', { now: AFTER })).toBe('purged');

    const blind = { ...host.storage, discard: async () => undefined, state: async () => 'unknown' as const };
    expect(await host.engine.eraseOwedImages('org-a', { now: AFTER, storage: blind })).toBe(3);
    expect((await host.pg.query(`SELECT images_erased_at FROM tenant_closings WHERE tenant_id = 'org-a'`)).rows).toEqual([{ images_erased_at: null }]);

    // A storage that throws on the second chunk (imageChunk 2): the first chunk is recorded, the rest stays owed.
    let calls = 0;
    const flaky = {
      ...host.storage,
      discard: async (scope: string, keys: readonly string[]) => {
        calls += 1;
        if (calls === 2) throw new Error('bucket down');
        await host.storage.discard(scope, keys);
      },
    };
    expect(await host.engine.eraseOwedImages('org-a', { now: AFTER, storage: flaky })).toBe(1);
    expect(host.errors.map((entry) => entry.act)).toEqual(['purgeImages']);
    expect((await host.pg.query(`SELECT image_keys_owed FROM legacy_closings WHERE org_id = 'org-a'`)).rows).toEqual([{ image_keys_owed: ['img/org-a/two.webp'] }]);

    const done = new Date(AFTER.getTime() + DAY_MS);
    const { value, statements } = await host.counted(() => host.engine.eraseOwedImages('org-a', { now: done }));
    expect(value).toBe(0);
    expect(statements.length).toBeLessThanOrEqual(3);
    expect([...host.objects].filter((key) => key.includes('org-a'))).toEqual([]);
    expect([...host.objects].filter((key) => key.includes('org-b'))).toHaveLength(2);
    const row = { image_keys_owed: [], images_erased_at: done };
    expect((await host.pg.query(`SELECT image_keys_owed, images_erased_at FROM tenant_closings WHERE tenant_id = 'org-a'`)).rows).toEqual([row]);
    expect((await host.pg.query(`SELECT image_keys_owed, images_erased_at FROM legacy_closings WHERE org_id = 'org-a'`)).rows).toEqual([row]);
    expect(await host.engine.eraseOwedImages('org-a', { now: done })).toBe(0);
  });

  it('C7: with no legacy key, heldElsewhere is never asked; with no key at all, nothing is recorded (two transactions)', async () => {
    const host = await ready();
    await host.seed('org-a', { images: ['img/org-a/one.webp'] });
    await host.seed('org-c');
    await host.closing('org-a');
    await host.closing('org-c');
    expect(await host.engine.run('org-a', { now: AFTER })).toBe('purged');
    const { transactions } = await host.counted(() => host.engine.run('org-c', { now: AFTER }));
    expect(transactions).toBe(2);
    expect(host.knobs.heldCalls).toEqual([]);
  });
});

describe('C2, C3, I1, I10: never on a live tenant, never early, nothing after the stamp', () => {
  it('an open tenant: notClosing, nothing written', async () => {
    const host = await ready();
    await host.seed('org-a');
    await host.closing('org-a');
    await host.pg.query(`UPDATE orgs SET status = 'OPEN' WHERE id = 'org-a'`);
    const { value, statements } = await host.counted(() => host.engine.run('org-a', { now: AFTER }));
    expect(value).toBe('notClosing');
    expect(statements.length).toBeLessThanOrEqual(3);
    expect(await host.count(`patients WHERE org_id = 'org-a'`)).toBe(2);
    expect((await host.pg.query(`SELECT status, city FROM orgs WHERE id = 'org-a'`)).rows).toEqual([{ status: 'OPEN', city: 'Recife' }]);
  });

  it('a closing tenant before its date: notDue, the flip rolled back, nothing erased', async () => {
    const host = await ready();
    await host.seed('org-a');
    await host.closing('org-a', { purgeAt: new Date(AFTER.getTime() + DAY_MS) });
    expect(await host.engine.run('org-a', { now: AFTER })).toBe('notDue');
    expect((await host.pg.query(`SELECT status, city FROM orgs WHERE id = 'org-a'`)).rows).toEqual([{ status: 'WINDING_DOWN', city: 'Recife' }]);
    expect(host.knobs.revokeCalls).toBe(0);
  });

  it('a closing tenant with no closing row: notClosing, the flip rolled back', async () => {
    const host = await ready();
    await host.seed('org-a');
    await host.pg.query(`UPDATE orgs SET status = 'WINDING_DOWN' WHERE id = 'org-a'`);
    expect(await host.engine.run('org-a', { now: AFTER })).toBe('notClosing');
    expect((await host.pg.query(`SELECT status FROM orgs WHERE id = 'org-a'`)).rows).toEqual([{ status: 'WINDING_DOWN' }]);
  });

  it('a run after purgedAt answers already and writes nothing but the CAS that moved no row', async () => {
    const host = await ready();
    await host.seed('org-a', { balance: 5 });
    await host.closing('org-a');
    expect(await host.engine.run('org-a', { now: AFTER })).toBe('purged');
    const { value, statements } = await host.counted(() => host.engine.run('org-a', { now: AFTER }));
    expect(value).toBe('already');
    expect(statements.length).toBeLessThanOrEqual(4);
    expect(writes(statements).every((sql) => /^UPDATE orgs SET status/u.test(sql))).toBe(true);
    expect(await host.count(`audit_lines WHERE org_id = 'org-a'`)).toBe(1);
    expect(await host.count(`ledger WHERE org_id = 'org-a'`)).toBe(1);
  });
});

describe('C4, C5: a run that stopped resumes where it stopped', () => {
  it('a beforeErase hook that throws leaves it closed, unstamped, owed recorded, nothing erased; the resume finishes and audits once', async () => {
    const host = await ready();
    await host.seed('org-a', { images: ['img/org-a/one.webp', 'img/two.webp'] });
    await host.closing('org-a');
    const failing = host.build({
      beforeErase: [
        async () => {
          throw new Error('storage refused the prefix delete');
        },
      ],
    });
    await expect(failing.run('org-a', { now: AFTER })).rejects.toThrow(/storage refused/u);
    expect((await host.pg.query(`SELECT status, city FROM orgs WHERE id = 'org-a'`)).rows).toEqual([{ status: 'SHUT', city: null }]);
    expect((await host.pg.query(`SELECT purged_at, image_keys_owed FROM tenant_closings WHERE tenant_id = 'org-a'`)).rows).toEqual([
      { purged_at: null, image_keys_owed: ['img/org-a/one.webp', 'img/two.webp'] },
    ]);
    expect(await host.count(`patients WHERE org_id = 'org-a'`)).toBe(2);

    // The resume: Tx-A is CAS (0), the status read, the row, the revocations; the profile is not cleared again.
    const { value, statements } = await host.counted(() => host.engine.run('org-a', { now: AFTER }));
    expect(value).toBe('purged');
    const txA = statements.slice(1, statements.findIndex((sql) => /FROM photos/u.test(sql)));
    expect(txA).toHaveLength(4);
    expect(host.knobs.clearCalls).toBe(1);
    expect(host.knobs.revokeCalls).toBe(2);
    expect(await host.count(`patients WHERE org_id = 'org-a'`)).toBe(0);
    // A union: the resume read fewer rows (the first run erased none, so the same) and lost no key.
    expect((await host.pg.query(`SELECT image_keys_owed FROM tenant_closings WHERE tenant_id = 'org-a'`)).rows[0]).toEqual({
      image_keys_owed: ['img/org-a/one.webp', 'img/two.webp'],
    });
    expect(await host.count(`audit_lines WHERE org_id = 'org-a'`)).toBe(1);
  });

  it('C6: a tenant not yet purged never has an object deleted', async () => {
    const host = await ready();
    await host.seed('org-a', { images: ['img/org-a/one.webp'] });
    await host.closing('org-a', { purgeAt: new Date(AFTER.getTime() + DAY_MS) });
    await host.pg.query(`UPDATE tenant_closings SET image_keys_owed = '{img/org-a/one.webp}' WHERE tenant_id = 'org-a'`);
    expect(await host.engine.eraseOwedImages('org-a', { now: AFTER })).toBe(0);
    expect(await host.engine.sweepImages(AFTER)).toEqual({ emptied: 0 });
    expect(host.objects.has('img/org-a/one.webp')).toBe(true);
  });
});

describe('C9, C13: the races the transactions settle', () => {
  it('C9: a reopen and a re-close that land before the flip are seen by it: notDue, nothing erased (main read the row first)', async () => {
    const host = await ready();
    await host.seed('org-a');
    await host.closing('org-a');
    host.knobs.beforeCas = async (tx) => {
      // Committed just before the CAS: the old close was undone and a new one, due in 30 days, took its place.
      await tx.query(`UPDATE tenant_closings SET requested_at = $2, purge_at = $3 WHERE tenant_id = $1`, ['org-a', AFTER, new Date(AFTER.getTime() + 30 * DAY_MS)]);
    };
    expect(await host.engine.run('org-a', { now: AFTER })).toBe('notDue');
    expect((await host.pg.query(`SELECT status FROM orgs WHERE id = 'org-a'`)).rows).toEqual([{ status: 'WINDING_DOWN' }]);
    expect(await host.count(`patients WHERE org_id = 'org-a'`)).toBe(2);
  });

  it('C9: a reopen that committed first wins: notClosing; a purge that flipped first refuses the reopen', async () => {
    const host = await ready();
    await host.seed('org-a');
    await host.seed('org-b');
    await host.closing('org-a');
    await host.closing('org-b');
    const record = (id: string) => ({ id, slug: id, status: 'WINDING_DOWN' as const, name: id });
    await host.lifecycleApi.lifecycle?.reopen({ tenant: record('org-a'), by: 'platform' });
    expect(await host.engine.run('org-a', { now: AFTER })).toBe('notClosing');
    expect(await host.count(`patients WHERE org_id = 'org-a'`)).toBe(2);

    expect(await host.engine.run('org-b', { now: AFTER })).toBe('purged');
    await expect(host.lifecycleApi.lifecycle?.reopen({ tenant: record('org-b'), by: 'platform' })).rejects.toMatchObject({ status: 409, kind: 'purged' });
    expect((await host.pg.query(`SELECT status FROM orgs WHERE id = 'org-b'`)).rows).toEqual([{ status: 'SHUT' }]);
  });

  it('C13: a run whose stamp finds the row stamped by an overlapping run writes nothing else: no zeroing, no audit', async () => {
    const host = await ready();
    await host.seed('org-a', { balance: 700 });
    await host.closing('org-a');
    const overlapped = host.build({
      beforeErase: [
        async () => {
          // The overlapping run finished meanwhile: it stamped, zeroed and audited.
          await host.pg.query(`UPDATE tenant_closings SET purged_at = $2 WHERE tenant_id = $1`, ['org-a', AFTER]);
        },
      ],
    });
    expect(await overlapped.run('org-a', { now: AFTER })).toBe('already');
    expect(host.knobs.zeroCalls).toBe(0);
    expect(await host.count(`ledger WHERE org_id = 'org-a'`)).toBe(0);
    expect(await host.count(`audit_lines WHERE org_id = 'org-a'`)).toBe(0);
    expect(host.knobs.mirrorCalls.filter((call) => 'purgedAt' in call.fields)).toEqual([]);
  });
});

describe('C10, I11, O1: a parent waits, still closing, until every unit below it is purged', () => {
  it('answers descendantsPending before anything is written, and purges on the pass after its unit', async () => {
    const host = await ready();
    await host.seed('org-p');
    await host.seed('org-u', { parent: 'org-p' });
    await host.closing('org-u', { status: 'SHUT' });
    await host.closing('org-p');

    const { value, statements } = await host.counted(() => host.engine.run('org-p', { now: AFTER }));
    expect(value).toBe('descendantsPending');
    expect(writes(statements)).toEqual([]);
    expect(statements).toHaveLength(2);
    expect((await host.pg.query(`SELECT status, city FROM orgs WHERE id = 'org-p'`)).rows).toEqual([{ status: 'WINDING_DOWN', city: 'Recife' }]);

    // A unit still open below: one read, pending.
    await host.seed('org-v', { parent: 'org-p' });
    expect((await host.counted(() => host.engine.run('org-p', { now: AFTER }))).statements).toHaveLength(1);
    await host.pg.query(`DELETE FROM orgs WHERE id = 'org-v'`);

    // The sweep: the keyset visits the parent first (same date, smaller id), then the unit.
    const lifecycle = host.lifecycleApi.lifecycle;
    const first = await lifecycle?.sweep(AFTER);
    expect(first?.purged).toBe(1);
    expect((await host.pg.query(`SELECT tenant_id FROM tenant_closings WHERE purged_at IS NOT NULL`)).rows).toEqual([{ tenant_id: 'org-u' }]);
    const second = await lifecycle?.sweep(AFTER);
    expect(second?.purged).toBe(1);
    expect(await host.count(`patients WHERE org_id = 'org-p'`)).toBe(0);
    expect(host.errors).toEqual([]);
  });
});

describe('the lifecycle with the engine wired', () => {
  it('stamps nothing itself and runs the image pass every sweep, counting a tenant once nothing is owed', async () => {
    const host = await ready();
    await host.seed('org-a', { images: ['img/org-a/one.webp'] });
    await host.closing('org-a');
    const lifecycle = host.lifecycleApi.lifecycle;
    const { value, statements } = await host.counted(async () => (lifecycle ? lifecycle.sweep(AFTER) : null));
    expect(value).toEqual({ reminded: { week: 0, day: 0 }, purged: 1, afterCloseRetried: 0, imagesErased: 1 });
    // One stamp of tenant_closings.purged_at: the engine's (the other is its mirror, into the older table).
    expect(statements.filter((sql) => /^UPDATE "?tenant_closings"? SET "?purged_at/u.test(sql))).toHaveLength(1);
    expect(host.objects.has('img/org-a/one.webp')).toBe(false);
    expect(await lifecycle?.sweep(AFTER)).toEqual({ reminded: { week: 0, day: 0 }, purged: 0, afterCloseRetried: 0, imagesErased: 0 });
  });
});
