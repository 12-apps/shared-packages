/**
 * The image pass: the objects a purged tenant still owes storage.
 *
 * Only after `purged_at` committed (a tenant still closing may reopen and keep
 * its photos). Per chunk of `imageChunk` keys: `discard` (never throws), then
 * `state` for every member of each key; a key is dropped only when EVERY
 * member is `absent`. `unknown` keeps it owed, and a throw stops the pass with
 * the rest owed: there is no retry inside a pass, the next sweep is the retry.
 * What went is recorded in ONE update (`EXCEPT`, sorted), with the mirror;
 * `images_erased_at` is stamped only on the pass that empties the list. A
 * failed record is reported to `onError`, never thrown: the objects are gone,
 * and the next pass finds them absent and drops them then.
 */
import type { PurgeEngine } from './engine';
import type { TenantPurgeStorage } from './types';

/** The keys of `chunk` whose every object storage confirms gone, after deleting them. */
async function eraseChunk(storage: TenantPurgeStorage, tenantId: string, chunk: readonly string[]): Promise<string[]> {
  await storage.discard(tenantId, chunk);
  const gone = await Promise.all(
    chunk.map(async (key) => (await Promise.all(storage.members(key).map((member) => storage.state(member)))).every((state) => state === 'absent')),
  );
  return chunk.filter((_, index) => gone[index]);
}

async function eraseAll<S extends string, Tx>(
  engine: PurgeEngine<S, Tx>,
  tenantId: string,
  owed: readonly string[],
  storage: TenantPurgeStorage,
): Promise<string[]> {
  const done: string[] = [];
  const size = engine.config.imageChunk;
  try {
    for (let start = 0; start < owed.length; start += size) done.push(...(await eraseChunk(storage, tenantId, owed.slice(start, start + size))));
  } catch (error) {
    engine.lifecycle.onError(error, { act: 'purgeImages', tenantId });
  }
  return done;
}

async function recordErased<S extends string, Tx>(
  engine: PurgeEngine<S, Tx>,
  tenantId: string,
  done: readonly string[],
  emptied: boolean,
  now: Date,
): Promise<void> {
  const { db, mirrorClosing } = engine.config;
  try {
    await db.transaction(async (tx) => {
      const rows = await db.query<{ image_keys_owed: string[] }>(
        `UPDATE ${engine.closings} SET "image_keys_owed" = ARRAY(SELECT unnest("image_keys_owed") EXCEPT SELECT unnest($2::text[]) ORDER BY 1), "images_erased_at" = COALESCE($3::timestamp(3), "images_erased_at") WHERE "tenant_id" = $1 RETURNING "image_keys_owed"`,
        [tenantId, [...done], emptied ? now : null],
        tx,
      );
      await mirrorClosing(tx, tenantId, { imageKeysOwed: rows[0]?.image_keys_owed ?? [], ...(emptied ? { imagesErasedAt: now } : {}) });
    });
  } catch (error) {
    engine.lifecycle.onError(error, { act: 'purgeImagesRecord', tenantId });
  }
}

/** One tenant's owed objects. Never throws; answers how many keys are still owed (-1 when its row could not be read). */
export async function eraseOwedImages<S extends string, Tx>(
  engine: PurgeEngine<S, Tx>,
  tenantId: string,
  at: { now: Date; storage?: TenantPurgeStorage },
): Promise<number> {
  try {
    const row = await (await engine.lifecycle.db.table()).findUnique({ where: { tenantId } });
    if (row === null || row.purgedAt === null) return 0;
    const owed = row.imageKeysOwed ?? [];
    if (owed.length === 0) return 0;
    const done = await eraseAll(engine, tenantId, owed, at.storage ?? engine.config.storage);
    const left = owed.length - done.length;
    if (done.length > 0) await recordErased(engine, tenantId, done, left === 0, at.now);
    return left;
  } catch (error) {
    engine.lifecycle.onError(error, { act: 'purgeImages', tenantId });
    return -1;
  }
}

/** Every purged tenant still owing objects, oldest purge first, `sweepBatch` of them. */
export async function sweepImages<S extends string, Tx>(engine: PurgeEngine<S, Tx>, now: Date): Promise<{ emptied: number }> {
  const rows = await engine.config.db.query<{ tenant_id: string }>(
    `SELECT "tenant_id" FROM ${engine.closings} WHERE "purged_at" IS NOT NULL AND cardinality("image_keys_owed") > 0 ORDER BY "purged_at" ASC, "tenant_id" ASC LIMIT $1`,
    [engine.lifecycle.sweepBatch],
  );
  let emptied = 0;
  for (const { tenant_id: tenantId } of rows) {
    if ((await eraseOwedImages(engine, tenantId, { now })) === 0) emptied += 1;
  }
  return { emptied };
}
