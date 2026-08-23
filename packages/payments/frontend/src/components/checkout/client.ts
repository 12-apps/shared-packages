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
 * Each takes the transport's COPY (FUT-760). Unbound is about the mount, not
 * about the language: a wire failure still has to say something to a buyer,
 * and the one thing this package must not do is pick those words itself. The
 * caller is `client-context.tsx`, which reads them from the checkout's copy
 * context — so no screen passes them by hand.
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

import type { CheckoutTransportCopy } from "./screens-copy";
import { createCheckoutClient } from "./transport";
import type {
  ChargeCardInput,
  ChargeOutcome,
  ChargeWalletInput,
  CheckoutProviderConfig,
  OrderStatus,
} from "./types";

/**
 * The default binding: `/api/checkout` on the ambient `fetch`, saying what the
 * caller's copy says when the wire fails.
 *
 * Built per call rather than once, because the words are now an argument. It
 * costs one closure and resolves `fetch` per call either way, so a suite that
 * stubs the global still wins.
 */
function defaultClient(copy: CheckoutTransportCopy) {
  return createCheckoutClient({ copy });
}

/** Poll an order's reconciled status (async provider webhook confirmation). */
export async function pollOrderStatus(
  orderId: string,
  copy: CheckoutTransportCopy,
): Promise<Result<OrderStatus>> {
  return defaultClient(copy).getStatus(orderId);
}

/**
 * `GET /api/checkout/config` — the store's active payment protocol (FUT-697):
 * which provider, how it tokenizes, with which PUBLIC key, and whether the
 * server grants stub-mode mock tokenization. Public like the menu — the buyer
 * has not signed in when the checkout decides which methods to render.
 */
export async function fetchCheckoutConfig(
  tenantSlug: string,
  copy: CheckoutTransportCopy,
): Promise<Result<CheckoutProviderConfig>> {
  return defaultClient(copy).getConfig(tenantSlug);
}

/**
 * `POST /api/checkout/refresh-key` — fetch/refresh the store's PagBank card
 * public key, scoped to the buyer's OWN order (the server derives the store
 * from it; never a client-supplied store id). Used both for the initial key
 * (the web page resolved it server-side) and for the FUT-174 rotated-key
 * self-heal retry.
 */
export async function refreshCardPublicKey(
  input: { orderId: string },
  copy: CheckoutTransportCopy,
): Promise<Result<{ publicKey: string | null }>> {
  return defaultClient(copy).refreshBrowserKey(input);
}

/**
 * Charge a tokenized (or saved) card against an order. The outcome carries a
 * `hostedCheckoutUrl` when the provider demands the buyer finish on its own
 * page (3-D Secure, FUT-698) — the caller then hands the buyer over.
 */
export async function chargeCard(
  input: ChargeCardInput,
  copy: CheckoutTransportCopy,
): Promise<Result<ChargeOutcome>> {
  return defaultClient(copy).charge(input);
}

/**
 * Charge a wallet-minted instrument against an order (FUT-471/472) — the same
 * `/charge` route as {@link chargeCard}, carrying `wallet: { type, key }` in
 * place of a card token.
 */
export async function chargeWallet(
  input: ChargeWalletInput,
  copy: CheckoutTransportCopy,
): Promise<Result<ChargeOutcome>> {
  return defaultClient(copy).chargeWallet(input);
}

/** List saved cards available for reuse (empty on any error — non-blocking). */
export async function listSavedCards(
  copy: CheckoutTransportCopy,
  tenantSlug?: string,
): Promise<SavedCard[]> {
  return defaultClient(copy).listInstruments(tenantSlug);
}
