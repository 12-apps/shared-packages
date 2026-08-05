/**
 * The checkout's PAYMENT client (FUT-43/57/45, moved into the library by
 * FUT-564) — polling, card charging, saved cards, key refresh and the
 * provider-protocol read, against the host-mounted `/api/checkout*` surface
 * (documented in `packages/payments/ADOPTING.md` §3).
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
import { err, ok, type Result } from "../../result";

import type {
  ChargeCardInput,
  ChargeOutcome,
  CheckoutProviderConfig,
  OrderStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** Envelope the API routes return: `{ data }` on success, `{ error }` on failure. */
interface ApiEnvelope<T> {
  data?: T;
  error?: string;
  /**
   * Stable machine code for the failure (`checkoutErrorResponse` always sends
   * one). Carried through so a surface can PRESENT a refusal for what it is —
   * an unresolved charge is not a decline, and rendering it under "não foi
   * possível pagar" with a live pay button invites the second payment its own
   * text forbids.
   */
  code?: string;
}

/**
 * A non-2xx envelope as a {@link Result} failure, carrying its machine CODE.
 * The message is what the buyer reads; the code is what a surface uses to
 * decide how to PRESENT it, which a message cannot be parsed for.
 */
function refused<T>(json: ApiEnvelope<T> | null): Result<T> {
  return err(json?.error ?? "Não foi possível concluir a operação. Tente novamente.", json?.code);
}

/** Call an API route and normalize the response into a {@link Result}. */
async function requestResult<T>(input: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(input, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!res.ok) return refused(json);
    if (!json || json.data === undefined) {
      return err(json?.error ?? "Resposta inválida do servidor.");
    }
    return ok(json.data);
  } catch {
    return err("Não foi possível conectar. Verifique sua conexão e tente novamente.");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * What a hosted checkout appended to the return URL when it sent the buyer
 * back, or undefined.
 *
 * InfinitePay's `payment_check` refuses to confirm without BOTH the
 * `transaction_nsu` and the invoice `slug`, and neither exists until somebody
 * has actually paid — they arrive here, on the redirect. Left in the URL: the
 * server treats them as hints, so re-sending them on later polls is harmless.
 *
 * Note the buyer has to press "Continuar" on the provider's receipt for this
 * redirect to happen at all, which is exactly why it is a hint and never the
 * mechanism: the webhook, and the server-side reconciliation behind it, are
 * what must work when they simply close the tab.
 */
function returnedSettlement(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  // BOTH. Measured against the live API: handle + order_nsu +
  // transaction_nsu + slug answers {"success":true,"paid":true,…}, and the
  // same call missing EITHER answers {"success":false}. Neither exists before
  // the payment, and the slug is not in the link-creation response — the
  // redirect and the webhook are the only places both appear together.
  const transactionNsu = params.get("transaction_nsu") ?? params.get("transaction_id") ?? "";
  const slug = params.get("slug") ?? "";
  return {
    ...(transactionNsu ? { transactionNsu } : {}),
    ...(slug ? { slug } : {}),
  };
}

/** Poll an order's reconciled status (async provider webhook confirmation). */
export async function pollOrderStatus(orderId: string): Promise<Result<OrderStatus>> {
  const params = new URLSearchParams({ orderId, ...returnedSettlement() });
  return requestResult<OrderStatus>(`/api/checkout/status?${params.toString()}`, {
    method: "GET",
  });
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
  return requestResult<CheckoutProviderConfig>(
    `/api/checkout/config?tenantSlug=${encodeURIComponent(tenantSlug)}`,
    { method: "GET" },
  );
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
  return requestResult<{ publicKey: string | null }>("/api/checkout/refresh-key", {
    method: "POST",
    body: JSON.stringify({ orderId: input.orderId }),
  });
}

/**
 * Charge a tokenized (or saved) card against an order. The outcome carries a
 * `hostedCheckoutUrl` when the provider demands the buyer finish on its own
 * page (3-D Secure, FUT-698) — the caller then hands the buyer over.
 */
export async function chargeCard(input: ChargeCardInput): Promise<Result<ChargeOutcome>> {
  return requestResult<ChargeOutcome>("/api/checkout/charge", {
    method: "POST",
    body: JSON.stringify({
      orderId: input.orderId,
      token: input.token,
      // One instrument per provider (FUT-563) — the server hands each provider
      // in the chain its own, which is what lets a card charge fail over.
      ...(input.tokensByProvider ? { tokensByProvider: input.tokensByProvider } : {}),
      saveCard: input.saveCard,
      cardMeta: input.cardMeta,
      taxId: input.taxId,
    }),
  });
}

/** List saved cards available for reuse (empty on any error — non-blocking). */
export async function listSavedCards(tenantSlug?: string): Promise<SavedCard[]> {
  // Scoped to the store when known (FUT-697): only cards the store's ACTIVE
  // provider can actually charge come back — a PagBank-vaulted card is not
  // offered for a Stone charge it would fail (or misroute).
  const query = tenantSlug ? `?tenantSlug=${encodeURIComponent(tenantSlug)}` : "";
  const result = await requestResult<SavedCard[]>(`/api/checkout/cards${query}`, {
    method: "GET",
  });
  return result.ok ? result.data : [];
}
