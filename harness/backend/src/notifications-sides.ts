/**
 * Who a spec acts as, and which SIDE of the business it reads as.
 *
 * Its own module so the host file stays under the size gate: this is the one
 * part of the notification host a spec steers per request.
 */

/** The header a spec sets to act as someone else; the SPA acts as the owner. */
export const ACTOR_HEADER = 'x-notifications-user';

/**
 * The header a spec sets to read AS one side of the business — the stand-in for
 * a host resolving which app is asking. Absent = every side, as the SPA reads.
 */
export const SIDE_HEADER = 'x-notifications-side';

/**
 * This host's sides, per type: a buyer's pedido is the customer's; a short
 * payment and a stock alert are the staff's. The vocabulary is the host's.
 */
const SIDES: Readonly<Record<string, string>> = {
  'order.paid': 'customer',
  'payment.short': 'staff',
  'stock.low': 'staff',
};

/** `sideOf` for `createApiNotifications`: an unlisted type is unclassified. */
export function sideOf(type: string): string | null {
  return SIDES[type] ?? null;
}

/**
 * The actor a request resolves to: the seeded owner when no header names one,
 * nobody for `anonymous` (the 401 path), narrowed to a side when one was asked.
 */
export function harnessActor(
  userHeader: string | undefined,
  sideHeader: string | undefined,
): { userId: string; scopeSide?: string } | null {
  const userId = userHeader ?? 'owner-1';
  if (userId === 'anonymous') return null;
  return sideHeader === undefined ? { userId } : { userId, scopeSide: sideHeader };
}
