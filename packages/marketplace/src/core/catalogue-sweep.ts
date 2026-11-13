import { catalogueDedupeKey, enqueueCatalogue, type CatalogueJobPayload } from "./catalogue-job";
import { CATALOGUE_ROW_SELECT, catalogueTable, type CatalogueRow } from "./catalogue-store";
import type { EngineContext } from "./ports";

/**
 * The outbound sweep's catalogue half (FUT-4768): nothing the store switched
 * on or off is lost, and nothing waits forever on "sending".
 *
 * A row still owed (PUBLISHING or WITHDRAWING) older than the catalogue job's
 * own retry span is re-queued under a key of its own per pass; one older than
 * the give-up is FAILED, with the action it failed at, so the host shows the
 * reason and "try again" instead of a switch stuck on its way.
 */

/** Longer than the catalogue job's three attempts with their backoff. */
export const CATALOGUE_STALE_MS = 10 * 60_000;

/** Past this, the marketplace is not going to answer this ask. */
export const CATALOGUE_GIVE_UP_MS = 24 * 60 * 60_000;

const GIVE_UP_REASON = "no answer from the marketplace within 24 hours";

/** One pass. Returns how many runs it re-queued. */
export async function sweepCatalogue(ctx: EngineContext, now: Date): Promise<number> {
  const table = await catalogueTable(ctx);
  if (!table) return 0;
  const stale = new Date(now.getTime() - CATALOGUE_STALE_MS);
  const giveUp = new Date(now.getTime() - CATALOGUE_GIVE_UP_MS);
  for (const [status, failedAction] of [["PUBLISHING", "PUBLISH"], ["WITHDRAWING", "WITHDRAW"]] as const) {
    await table.updateMany({
      where: { status, requestedAt: { lt: giveUp } },
      data: { status: "FAILED", failedAction, failureReason: GIVE_UP_REASON, failedAt: now },
    });
  }
  const rows = (await table.findMany({
    where: { status: { in: ["PUBLISHING", "WITHDRAWING"] }, requestedAt: { lt: stale, gte: giveUp } },
    select: CATALOGUE_ROW_SELECT,
  })) as CatalogueRow[];
  for (const row of rows) {
    const action = row.status === "PUBLISHING" ? "publish" : "withdraw";
    const payload: CatalogueJobPayload = { clientId: row.clientId, publicationId: row.id, action };
    await enqueueCatalogue(ctx, payload, `${catalogueDedupeKey(payload, row.requestedAt)}:sweep:${now.getTime()}`);
  }
  return rows.length;
}
