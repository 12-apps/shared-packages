import { useCallback, useSyncExternalStore } from 'react';

/**
 * "I have switched Checkout Integrado on" — the one setup fact no API answers.
 *
 * InfinitePay ships Checkout Integrado disabled and exposes nothing that
 * reports its state: `payment_check` resolves the handle and stops there. So a
 * store can pass "Testar conexão", read a green result, and still be unable to
 * create a single payment link. The only way to know is to ask the owner, and
 * the only honest thing to do with the answer is treat it as a claim — which
 * step 3 then either confirms, by minting a link, or refutes, by being refused.
 *
 * ## Why the browser keeps it
 *
 * It is not a fact about the merchant's account, it is a fact about what the
 * owner has told us, so putting it in `payment_provider_configs` would dress a
 * self-report up as provider state — and the schema already carries one field
 * (`chargeVerifiedAt`) that means "proved by money moving". Two fields one
 * letter apart in meaning is how a screen ends up claiming a store can charge.
 *
 * `localStorage` and not React state because the flow deliberately LEAVES the
 * page: the owner pays on InfinitePay's site and comes back. In-memory, that
 * round trip would drop the acknowledgement and bounce them to step 2 —
 * hiding the panel that is polling the payment they just made.
 *
 * Keyed by the client's base URL, which is tenant-scoped
 * (`/api/admin/<slug>/payments`), so an owner who administers two stores does
 * not confirm the setting once and have it apply to the other.
 */

function storageKey(scope: string, provider: string): string {
  return `payments:checkout-confirmed:${scope}:${provider}`;
}

/** Cross-component notification — two panels must not disagree about this. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // A confirmation made in another TAB is the same owner saying the same
  // thing; nothing here should contradict it.
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * Every read and write is guarded: `localStorage` throws outright in a
 * partitioned or storage-blocked context, and a setup screen must not go blank
 * because a browser declined to remember a checkbox. Unavailable storage
 * simply means "not confirmed yet" — the owner confirms again, which costs a
 * click and nothing else.
 */
function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function write(key: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(key, 'true');
    else window.localStorage.removeItem(key);
  } catch {
    // Nothing to recover: the caller's UI already reflects the intent, and the
    // worst case is being asked to confirm once more on the next visit.
  }
  listeners.forEach((listener) => listener());
}

interface CheckoutAck {
  /** The owner has said Checkout Integrado is on for this store. */
  confirmed: boolean;
  confirm: () => void;
  /**
   * Withdraw it. Called when the provider REFUSES to mint a link, which is the
   * strongest available evidence that the setting is in fact off — leaving the
   * claim standing there would keep the owner on a step 3 that cannot work.
   */
  withdraw: () => void;
}

export function useCheckoutAck(scope: string, provider: string | null): CheckoutAck {
  const key = provider ? storageKey(scope, provider) : null;

  const confirmed = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : false),
    // Server render: nothing is confirmed, which is the state that shows the
    // step rather than the state that skips it.
    () => false,
  );

  const confirm = useCallback(() => {
    if (key) write(key, true);
  }, [key]);
  const withdraw = useCallback(() => {
    if (key) write(key, false);
  }, [key]);

  return { confirmed, confirm, withdraw };
}
