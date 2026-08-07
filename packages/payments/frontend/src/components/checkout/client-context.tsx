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
 */
import { createContext, useContext, type JSX, type ReactNode } from "react";

import {
  chargeCard,
  fetchCheckoutConfig,
  listSavedCards,
  pollOrderStatus,
  refreshCardPublicKey,
} from "./client";
import type { CheckoutClient } from "./transport";

/** The unbound client: `/api/checkout` on the ambient `fetch`. */
const DEFAULT_CLIENT: CheckoutClient = {
  getConfig: (tenantSlug) => fetchCheckoutConfig(tenantSlug),
  getStatus: (ref) => pollOrderStatus(ref),
  charge: (input) => chargeCard(input),
  listInstruments: (tenantSlug) => listSavedCards(tenantSlug),
  refreshBrowserKey: (input) => refreshCardPublicKey(input),
};

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

/** The bound client, or the module default when no provider sits above. */
export function useCheckoutClientApi(): CheckoutClient {
  return useContext(CheckoutClientContext) ?? DEFAULT_CLIENT;
}
