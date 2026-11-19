import type { DeletionContext } from "./context";
import type { DeletionMailKind } from "./types";

/**
 * The one-slot mail outbox on the row. A send first TAKES the slot (a short
 * lease, predicated on the kind, the purge date and the window's state), so a
 * stale snapshot, a reminder after a cancel or two passes at once never mail;
 * it is cleared only once the mail left, and released on a failure so the next
 * pass retries it. A process that dies after the send and before the clear
 * sends once more after the lease (ADOPTING.md).
 */

const MAIL_LEASE_MS = 5 * 60_000;

type FlushOutcome = "sent" | "skipped" | "failed";

/** The state the window must still be in for this kind of mail to be owed. */
function windowFor(kind: string, purgeAt: Date): Record<string, unknown> {
  return kind === "cancelled" ? { requestedAt: null } : { requestedAt: { not: null }, purgeAt, purgeClaimedAt: null };
}

async function takeSlot(ctx: DeletionContext, userId: string, kind: string, purgeAt: Date, now: Date): Promise<boolean> {
  const taken = await (await ctx.table()).updateMany({
    where: {
      userId,
      deletedAt: null,
      mailOwed: kind,
      mailPurgeAt: purgeAt,
      ...windowFor(kind, purgeAt),
      OR: [{ mailClaimedAt: null }, { mailClaimedAt: { lte: new Date(now.getTime() - MAIL_LEASE_MS) } }],
    },
    data: { mailClaimedAt: now },
  });
  return taken.count === 1;
}

async function send(ctx: DeletionContext, userId: string, kind: string, purgeAt: Date): Promise<void> {
  const to = await ctx.config.emailOf(userId);
  if (!to) throw new Error("no e-mail for the person yet");
  await ctx.config.mail({ kind: kind as DeletionMailKind, to, userId, purgeAt });
}

export async function flush(ctx: DeletionContext, userId: string, kind: string, purgeAt: Date, now: Date): Promise<FlushOutcome> {
  const claimedAt = new Date(now.getTime());
  if (!(await takeSlot(ctx, userId, kind, purgeAt, claimedAt))) return "skipped";
  const db = await ctx.table();
  try {
    await send(ctx, userId, kind, purgeAt);
  } catch (error) {
    ctx.reportError(error, `mail:${kind}`, userId);
    await db.updateMany({ where: { userId, mailClaimedAt: claimedAt }, data: { mailClaimedAt: null } });
    return "failed";
  }
  await db.updateMany({ where: { userId, mailClaimedAt: claimedAt }, data: { mailOwed: null, mailPurgeAt: null, mailClaimedAt: null } });
  return "sent";
}
