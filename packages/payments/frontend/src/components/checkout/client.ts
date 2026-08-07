/**
 * The checkout's PAYMENT client (FUT-43/57/45, moved into the library by
 * FUT-564) — polling, card charging, saved cards, key refresh and the
 * provider-protocol read, against the host-mounted `/api/checkout*` surface
 * (documented in `packages/payments/ADOPTING.md` §3).
 *
 * Since FUT-741 these are the UNBOUND door onto `createCheckoutClient` — the
 * same five calls, on the default `/api/checkout` prefix and the ambient
 * `fetch`. They stay exported, and stay byte-identical on the wire, because
 * they are what is already running in buyers' browsers and what both pinned
 * wire suites drive. A host that needs a different mount, its own headers or an
 * injected `fetch` reaches for `createPaymentFlows({ transport })` instead;
 * nothing about these functions changes when it does.
 *
 * Order CREATION and the buyer-profile save are deliberately NOT here: both
 * are host domain (the cart, the account) and reach the flow as ports
 * (`createOrder` / `saveBuyerContact` on `CheckoutFlowProps`).
 *
 * Tokenization is not here either: it is a browser-only step shared with the
 * admin's provider-activation charge, so it lives in this package's `card/`
 * module.
 */

import type { SavedCard } from "../../card";
import type { Result } from "../../result";

import { createCheckoutClient } from "./transport";
import type {
  ChargeCardInput,
  ChargeOutcome,
  CheckoutProviderConfig,
  OrderStatus,
} from "./types";

/**
 * The default binding: `/api/checkout` on the ambient `fetch`. Built once, but
 * it resolves `fetch` per call, so a suite that stubs the global still wins.
 */
const defaultClient = createCheckoutClient();

/** Poll an order's reconciled status (async provider webhook confirmation). */
export async function pollOrderStatus(orderId: string): Promise<Result<OrderStatus>> {
  return defaultClient.getStatus(orderId);
}

/**
 * `GET /api/checkout/config` — the store's active payment protocol (FUT-697):
 * which provider, how it tokenizes, with which PUBLIC key, and whether the
 * server grants stub-mode mock tokenization. Public like the menu — the buyer
 * has not signed in when the checkout decides which methods to render.
 */
export async function fetchCheckoutConfig(
  tenantSlug: string,
): Promise<Result<CheckoutProviderConfig>> {
  return defaultClient.getConfig(tenantSlug);
}

/**
 * `POST /api/checkout/refresh-key` — fetch/refresh the store's PagBank card
 * public key, scoped to the buyer's OWN order (the server derives the store
 * from it; never a client-supplied store id). Used both for the initial key
 * (the web page resolved it server-side) and for the FUT-174 rotated-key
 * self-heal retry.
 */
export async function refreshCardPublicKey(input: {
  orderId: string;
}): Promise<Result<{ publicKey: string | null }>> {
  return defaultClient.refreshBrowserKey(input);
}

/**
 * Charge a tokenized (or saved) card against an order. The outcome carries a
 * `hostedCheckoutUrl` when the provider demands the buyer finish on its own
 * page (3-D Secure, FUT-698) — the caller then hands the buyer over.
 */
export async function chargeCard(input: ChargeCardInput): Promise<Result<ChargeOutcome>> {
  return defaultClient.charge(input);
}

/** List saved cards available for reuse (empty on any error — non-blocking). */
export async function listSavedCards(tenantSlug?: string): Promise<SavedCard[]> {
  return defaultClient.listInstruments(tenantSlug);
}
