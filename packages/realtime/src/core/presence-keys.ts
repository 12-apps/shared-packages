/**
 * The shape of a presence key, apart from everything that moves one (`./presence.ts`).
 *
 * Its own module so `./ticket.ts` can check a signed payload without importing the
 * runtime: the ticket subpath must stay a pure crypto helper a host can load with no
 * driver configured.
 */

/** How many keys one connection may hold — a guardrail on a signed payload, not a policy. */
export const MAX_PRESENCE_KEYS = 4;

/** Printable, no whitespace, not reserved (`$…`), at most 200 characters. */
const KEY_RE = /^[^\s$][^\s]{0,199}$/;

/** Whether `key` is a presence key a ticket may carry. */
export function isValidPresenceKey(key: unknown): key is string {
  return typeof key === "string" && KEY_RE.test(key);
}

/** Whether `keys` is a presence list a connection may hold. */
export function isValidPresenceList(keys: unknown): keys is string[] {
  return (
    Array.isArray(keys) && keys.length <= MAX_PRESENCE_KEYS && keys.every(isValidPresenceKey)
  );
}
