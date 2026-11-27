/**
 * One purge run, in its transactions:
 *
 * 0. **Tree** (with one): the descendants, ONE read; when every one is closed,
 *    their closing rows, ONE read. A descendant not purged answers
 *    `descendantsPending` before anything is written: the tenant stays
 *    closing, and restorable, until every unit below it is purged.
 * A. **The flip, first** (one transaction): the status CAS closing → closed is
 *    the transaction's FIRST statement, and the closing row is read AFTER it,
 *    so a reopen and a re-close landing before it are both seen (a purge is
 *    never early). A row not due, missing or already purged rolls the flip
 *    back. A CAS that moved nothing reads the status: closed is a run that
 *    stopped half way and resumes; anything else is `notClosing`. Then
 *    `clearProfile` (only on the flip: a resume already cleared it) and
 *    `revokeCredentials`.
 * B. **The owed objects** (one transaction): the keys collected, filtered to
 *    the tenant's scope, legacy ones another tenant holds dropped
 *    (`heldElsewhere`, ONE call, only when there is one), ADDED to
 *    `image_keys_owed` (a union: a resumed run that reads fewer rows loses
 *    nothing), mirrored.
 * C. **`beforeErase`**, in order, then **the erase**, one statement each,
 *    autocommit, outside any transaction (no timeout applies to it).
 * D. **The stamp, first** (one transaction): `purged_at` where still null. A
 *    stamp that moved no row answers `already` and writes nothing else, so an
 *    overlapping run never zeroes a balance twice. Then the mirror,
 *    `zeroBalances` and the audit line.
 * E. `invalidate`, quietly.
 *
 * Nothing here reaches storage: the owed objects go in the image pass, after
 * the stamp committed (`./images.ts`).
 */
import type { TenantClosingRow, TenantClosingTable } from '../lifecycle/types';
import { TenantConfigError } from '../validate';
import type { PurgeEngine } from './engine';
import type { TenantPurgeOutcome } from './types';

/** Thrown inside the flip's transaction to roll it back with an answer. */
class Stop extends Error {
  constructor(readonly outcome: Exclude<TenantPurgeOutcome, 'purged'>) {
    super(outcome);
  }
}

/** Whether every descendant is purged: closed, and its closing row stamped. */
async function descendantsPurged<S extends string, Tx>(engine: PurgeEngine<S, Tx>, tenantId: string): Promise<boolean> {
  const { tree } = engine.tenant;
  if (tree === undefined) return true;
  const below = await tree.descendantsOf(tenantId);
  if (below.length === 0) return true;
  const { closed } = engine.statuses;
  const closedAll = below.every((node) => {
    if (typeof node.status !== 'string') {
      throw new TenantConfigError('tree.treeDescendants', `returned tenant "${node.id}" with no status, which the purge needs`);
    }
    return node.status === closed;
  });
  if (!closedAll) return false;
  const ids = below.map((node) => node.id);
  const rows = await engine.config.db.query<{ tenant_id: string }>(
    `SELECT "tenant_id" FROM ${engine.closings} WHERE "tenant_id" = ANY($1::text[]) AND "purged_at" IS NOT NULL`,
    [ids],
  );
  return rows.length === ids.length;
}

/** Step A's body: answers the closing row to purge under. */
async function flip<S extends string, Tx>(engine: PurgeEngine<S, Tx>, tenantId: string, now: Date, tx: Tx): Promise<TenantClosingRow> {
  const { statuses } = engine;
  const moved = await engine.tenant.setStatusIf(tenantId, statuses.closing, statuses.closed, tx);
  if (!moved && (await engine.tenant.byId(tenantId, tx))?.status !== statuses.closed) throw new Stop('notClosing');
  const table: TenantClosingTable = await engine.lifecycle.db.table(tx);
  const row = await table.findUnique({ where: { tenantId } });
  if (row === null) throw new Stop('notClosing');
  if (row.purgedAt !== null) throw new Stop('already');
  if (row.purgeAt.getTime() > now.getTime()) throw new Stop('notDue');
  if (moved) await engine.tenant.port.clearProfile(tx, tenantId);
  await engine.config.revokeCredentials(tx, tenantId);
  return row;
}

/** The tenant's own keys: minted by the host's scheme, in its scope, and (legacy) held by no other tenant. Sorted. */
async function owedKeys<S extends string, Tx>(engine: PurgeEngine<S, Tx>, tenantId: string): Promise<string[]> {
  const { config } = engine;
  const found = [...new Set(await config.collectImageKeys(tenantId))].filter((key) => {
    const parsed = config.parseKey(key);
    if (parsed === null) return false;
    return parsed.scope === null ? config.unscopedKeys === 'accept' : parsed.scope === tenantId;
  });
  const legacy = found.filter((key) => config.parseKey(key)?.scope === null);
  const held = legacy.length === 0 ? new Set<string>() : await config.heldElsewhere(tenantId, legacy);
  return found.filter((key) => !held.has(key)).sort();
}

/** Step B: add the keys to what the tenant owes storage, with the mirror. */
async function recordOwed<S extends string, Tx>(engine: PurgeEngine<S, Tx>, tenantId: string): Promise<void> {
  const keys = await owedKeys(engine, tenantId);
  if (keys.length === 0) return;
  const { db, mirrorClosing } = engine.config;
  await db.transaction(async (tx) => {
    const rows = await db.query<{ image_keys_owed: string[] }>(
      `UPDATE ${engine.closings} SET "image_keys_owed" = ARRAY(SELECT DISTINCT unnest("image_keys_owed" || $2::text[]) ORDER BY 1) WHERE "tenant_id" = $1 RETURNING "image_keys_owed"`,
      [tenantId, keys],
      tx,
    );
    await mirrorClosing(tx, tenantId, { imageKeysOwed: rows[0]?.image_keys_owed ?? keys });
  });
}

/** Step C: the hooks, then every statement of the plan, autocommit. */
async function erase<S extends string, Tx>(engine: PurgeEngine<S, Tx>, tenantId: string, now: Date): Promise<void> {
  for (const hook of engine.config.beforeErase) await hook(tenantId, { now });
  for (const statement of engine.plan.statements) {
    await engine.config.db.execute(statement.sql, [tenantId, ...statement.params()]);
  }
}

/** Step D: the stamp first; only a stamp that moved a row mirrors, zeroes and audits. */
async function stamp<S extends string, Tx>(engine: PurgeEngine<S, Tx>, tenantId: string, row: TenantClosingRow, now: Date): Promise<boolean> {
  const { db, mirrorClosing, zeroBalances } = engine.config;
  return db.transaction(async (tx) => {
    const stamped = await db.execute(
      `UPDATE ${engine.closings} SET "purged_at" = $2 WHERE "tenant_id" = $1 AND "purged_at" IS NULL`,
      [tenantId, now],
      tx,
    );
    if (stamped === 0) return false;
    await mirrorClosing(tx, tenantId, { purgedAt: now });
    await zeroBalances(tx, tenantId);
    await engine.config.audit(tx, engine.tenant.config.ids.audit.closePurged, {
      act: 'closePurged',
      tenantId,
      purgeAt: row.purgeAt,
      erased: engine.plan.erased,
    });
    return true;
  });
}

async function flipOrStop<S extends string, Tx>(
  engine: PurgeEngine<S, Tx>,
  tenantId: string,
  now: Date,
): Promise<TenantClosingRow | Stop> {
  try {
    return await engine.config.db.transaction((tx) => flip(engine, tenantId, now, tx));
  } catch (error) {
    if (error instanceof Stop) return error;
    throw error;
  }
}

export async function runPurge<S extends string, Tx>(engine: PurgeEngine<S, Tx>, tenantId: string, at: { now: Date }): Promise<TenantPurgeOutcome> {
  const { now } = at;
  if (!(await descendantsPurged(engine, tenantId))) return 'descendantsPending';
  const row = await flipOrStop(engine, tenantId, now);
  if (row instanceof Stop) return row.outcome;
  await recordOwed(engine, tenantId);
  await erase(engine, tenantId, now);
  if (!(await stamp(engine, tenantId, row, now))) return 'already';
  try {
    await engine.lifecycle.invalidate(tenantId);
  } catch (error) {
    engine.lifecycle.onError(error, { act: 'invalidate', tenantId });
  }
  return 'purged';
}
