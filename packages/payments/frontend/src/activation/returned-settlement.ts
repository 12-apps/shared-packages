/**
 * The settlement a redirect provider hands back on the return trip, made
 * durable (FUT-763).
 *
 * The activation charge is paid on the PROVIDER'S site, so "left this page and
 * came back" is the normal path. The provider appends the ids that prove the
 * payment to the return URL, and those ids exist nowhere before the payment
 * and — without care — nowhere after the first render: reading and scrubbing
 * them in one call destroys them on a re-render, and a reload (the natural
 * reaction to a screen that looks stuck) destroys an in-memory copy too.
 *
 * So they are parked in `sessionStorage` BEFORE the URL is scrubbed, survive
 * both, and are cleared only when the charge settles.
 *
 * This is protocol, not presentation, which is why it moved: every host that
 * mounts a redirect provider gets the same return trip, and the ordering above
 * is not something a host should have to rediscover — it was rediscovered once
 * already, by a payment that was confirmed, thrown away, and never asked about
 * again.
 */

/**
 * The default parking slot.
 *
 * Namespaced by the package rather than by an app, and overridable, so two
 * surfaces of the same host can run the flow without reading each other's
 * parked ids.
 */
export const RETURNED_SETTLEMENT_KEY = 'payments:activation-settlement';

/**
 * The ids a redirect provider appends, and the aliases it may use for them.
 *
 * Both matter, and this was measured against the live API rather than read off
 * a doc page:
 *
 *   handle + order id + transaction id + slug → paid
 *   the same call minus the slug              → not paid
 *   the same call minus the transaction id    → not paid
 *
 * Neither is optional and neither exists before the payment. Asking with only
 * the transaction id — while expecting the slug from link creation, where the
 * provider does not put it — is a question that always answers no.
 */
const TRANSACTION_PARAMS = ['transaction_nsu', 'transaction_id'] as const;
const SLUG_PARAM = 'slug';

/**
 * Everything the return trip may carry, scrubbed together.
 *
 * Wider than what is READ: a receipt link and a capture method identify a
 * payment just as well, and have no business persisting in a URL somebody
 * might copy or a history entry a reload might replay.
 */
const SETTLEMENT_PARAMS = [
  ...TRANSACTION_PARAMS,
  'order_nsu',
  SLUG_PARAM,
  'receipt_url',
  'capture_method',
];

function parked(storageKey: string): Record<string, string> {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The charge settled — either way — so the parked ids have done their job. */
export function clearReturnedSettlement(storageKey = RETURNED_SETTLEMENT_KEY): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Best-effort: a stale parked value is re-sent once and ignored server-side.
  }
}

/**
 * Read the return trip's ids, park them, and take them out of the address bar.
 *
 * Safe to call on every render and every poll — which it is. With nothing in
 * the URL it answers with whatever is already parked, so the fifth ask carries
 * the same proof as the first.
 */
export function takeReturnedSettlement(
  storageKey = RETURNED_SETTLEMENT_KEY,
): Record<string, string> {
  if (typeof window === 'undefined') return {};

  const params = new URLSearchParams(window.location.search);
  const transactionNsu = TRANSACTION_PARAMS.map((key) => params.get(key)).find(Boolean) ?? '';
  const slug = params.get(SLUG_PARAM) ?? '';
  if (!transactionNsu && !slug) return parked(storageKey);

  const captured = {
    ...(transactionNsu ? { transactionNsu } : {}),
    ...(slug ? { slug } : {}),
  };
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(captured));
  } catch {
    // Storage refused (private-mode quirks): the in-URL copy still exists for
    // this page-load, and the server persists the slug after one good poll.
  }
  scrubSettlementParams(params);
  return captured;
}

/** Take the settlement params back out of the address bar, read once. */
function scrubSettlementParams(params: URLSearchParams): void {
  for (const key of SETTLEMENT_PARAMS) params.delete(key);
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}
