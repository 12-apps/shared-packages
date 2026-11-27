/**
 * The purge's half of the data export (the purge engine's `beforeErase`): the
 * rows go FIRST, with the mirror, then every archive under the tenant's
 * prefix.
 *
 * The order is what closes the race with a build still in flight: a build
 * that stores its archive before the prefix delete has it deleted by it; one
 * that stores it after finds no row for its READY write and deletes its own
 * archive (`./build`, `finishedElsewhere`); its heartbeat finds the row gone
 * and stops. Either way nothing is left in storage once the purge is done.
 *
 * Storage refusing throws, before the rest of the purge erases anything, and
 * the closing sweep resumes the purge on its next pass.
 */
import type { ExportEngine } from './engine';

export async function eraseExports<S extends string, Tx>(engine: ExportEngine<S, Tx>, tenantId: string): Promise<void> {
  const { db, mirror, archives } = engine.config;
  await db.transaction(async (tx) => {
    await (await engine.table(tx)).deleteMany({ where: { tenantId } });
    if (mirror !== undefined) await mirror.deleted(tx, tenantId);
  });
  await archives.deleteTenant(tenantId);
}
