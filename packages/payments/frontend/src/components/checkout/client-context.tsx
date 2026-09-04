/**
 * WHICH client the checkout screens talk through (FUT-741).
 *
 * Before this, every screen imported the free functions in `client.ts`
 * directly, so the mount they reach was a module-level constant: one prefix,
 * the ambient `fetch`, no headers. That is right for the shipped storefront
 * and impossible for anything else — a story, a harness page or a second host
 * on a different mount could only get at the wire by replacing `globalThis.
 * fetch`, which is a mock of OUR OWN client and the exact blind spot the
 * FUT-740 review's three criticals lived in.
 *
 * So the client is context now, with the module-level one as the default. A
 * tree with no provider behaves exactly as it did; a tree under
 * `createPaymentFlows`'s provider talks through the bound transport.
 *
 * The default is built from the `client.ts` bindings LAZILY (inside each
 * arrow), so a suite that `vi.mock`s that module still intercepts the call.
 *
 * Since FUT-760 that default also needs the transport's WORDS, and it takes
 * them from the checkout's copy context — which is why {@link
 * useCheckoutClientApi} builds it instead of holding it as a module constant.
 * No screen passes them: a screen already has the copy provider above it, or
 * it would not render at all.
 */
import { createContext, useContext, useMemo, type JSX, type ReactNode } from "react";

import {
  chargeCard,
  chargeWallet,
  fetchCheckoutConfig,
  listSavedCards,
  pollOrderStatus,
  refreshCardPublicKey,
} from "./client";
import { useCheckoutCopy } from "./copy-context";
import type { CheckoutTransportCopy } from "./screens-copy";
import { createCheckoutClient, type CheckoutClient } from "./transport";

/** The unbound client: `/api/checkout` on the ambient `fetch`. */
function unboundClient(copy: CheckoutTransportCopy): CheckoutClient {
  return {
    getConfig: (tenantSlug) => fetchCheckoutConfig(tenantSlug, copy),
    getStatus: (ref) => pollOrderStatus(ref, copy),
    charge: (input) => chargeCard(input, copy),
    chargeWallet: (input) => chargeWallet(input, copy),
    listInstruments: (tenantSlug) => listSavedCards(copy, tenantSlug),
    // The vault pair (FUT-183) has no `client.ts` free function to bind — it is
    // newer than that module. Built lazily from the default transport instead,
    // which is the same wire: `/api/checkout`, ambient `fetch` resolved per call.
    // Same lazy build as the vault pair below, and for the same reason: this
    // row is newer than `client.ts`, so there is no free function to bind.
    releaseCheckout: (input) => createCheckoutClient({ copy }).releaseCheckout(input),
    beginVault: () => createCheckoutClient({ copy }).beginVault(),
    completeVault: (input) => createCheckoutClient({ copy }).completeVault(input),
    refreshBrowserKey: (input) => refreshCardPublicKey(input, copy),
  };
}

const CheckoutClientContext = createContext<CheckoutClient | null>(null);

/** Point everything below at one bound {@link CheckoutClient}. */
export function CheckoutClientProvider({
  client,
  children,
}: {
  client: CheckoutClient;
  children: ReactNode;
}): JSX.Element {
  return (
    <CheckoutClientContext.Provider value={client}>{children}</CheckoutClientContext.Provider>
  );
}

/** The bound client, or the unbound one when no provider sits above. */
export function useCheckoutClientApi(): CheckoutClient {
  const provided = useContext(CheckoutClientContext);
  const copy = useCheckoutCopy().screens.transport;
  return useMemo(() => provided ?? unboundClient(copy), [provided, copy]);
}
