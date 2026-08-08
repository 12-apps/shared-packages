/**
 * The checkout's HTTP transport, as a bound client (FUT-741).
 *
 * Everything `client.ts` used to do with a hard-coded prefix and the ambient
 * `fetch` now lives here behind {@link createCheckoutClient}, so the same five
 * calls can be pointed at a different mount, carry a host's auth headers, or —
 * the reason this exists — be driven through an injected `fetch` that routes
 * straight into a real `createPaymentFlowsBE` mount. A story or a harness page
 * can then exercise the WIRE rather than a mock of our own client, which is the
 * only place the FUT-740 review found its three criticals.
 *
 * `baseUrl` defaults to `/api/checkout` VERBATIM — not normalized, not
 * re-derived. The published client already posts those exact paths, and both
 * pinned wire suites drive them; a prefix that is "cleaned up" here breaks the
 * shipped contract in the same release that introduces the factory.
 */

import type { SavedCard } from "../../card";
import { err, ok, type Result } from "../../result";

import type {
  ChargeCardInput,
  ChargeOutcome,
  ChargeWalletInput,
  CheckoutProviderConfig,
  OrderStatus,
} from "./types";

/**
 * The prefix every shipped buyer checkout posts to today. Exported so a host
 * (or a test) can state it rather than re-type it, and so a change to it is a
 * change to one named constant with this comment attached.
 */
export const DEFAULT_CHECKOUT_BASE_URL = "/api/checkout";

/** Where the `createPaymentFlowsBE` mount lives, and how to reach it. */
export interface CheckoutTransport {
  /** Prefix for `/config`, `/status`, `/charge`, `/cards`, `/refresh-key`. */
  baseUrl?: string;
  /**
   * The `fetch` to call. Omitted ⇒ the ambient one, resolved PER CALL so a
   * suite that stubs the global after the client was built still sees its stub.
   */
  fetchImpl?: typeof fetch;
  /** Extra headers per request (a bearer token, a tenant header). */
  headers?: () => HeadersInit | Promise<HeadersInit>;
}

/** The six calls the buyer checkout makes, pre-bound to a {@link CheckoutTransport}. */
export interface CheckoutClient {
  getConfig(tenantSlug: string): Promise<Result<CheckoutProviderConfig>>;
  getStatus(ref: string): Promise<Result<OrderStatus>>;
  charge(input: ChargeCardInput): Promise<Result<ChargeOutcome>>;
  /** A wallet instrument against the same `/charge` route (FUT-471/472). */
  chargeWallet(input: ChargeWalletInput): Promise<Result<ChargeOutcome>>;
  listInstruments(tenantSlug?: string): Promise<SavedCard[]>;
  refreshBrowserKey(input: { orderId: string }): Promise<Result<{ publicKey: string | null }>>;
}

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

/** The ambient `fetch`, wrapped so it is never invoked detached from its global. */
function ambientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

/**
 * The FLAT card-charge body the shipped client has always sent. Pinned from
 * both ends by `charge-wire.contract.test.ts`; nothing here may re-nest it.
 */
function flatChargeBody(input: ChargeCardInput): string {
  return JSON.stringify({
    orderId: input.orderId,
    token: input.token,
    // One instrument per provider (FUT-563) — the server hands each provider
    // in the chain its own, which is what lets a card charge fail over.
    ...(input.tokensByProvider ? { tokensByProvider: input.tokensByProvider } : {}),
    saveCard: input.saveCard,
    cardMeta: input.cardMeta,
    taxId: input.taxId,
  });
}

/**
 * The same flat wire with `wallet` in place of `token` (FUT-471): the mount's
 * draft reader takes either, and a body naming both would carry two
 * instruments for one charge. Pinned by `wallet-wire.contract.test.ts`.
 */
function flatWalletBody(input: ChargeWalletInput): string {
  return JSON.stringify({
    orderId: input.orderId,
    wallet: input.wallet,
    taxId: input.taxId,
  });
}

/**
 * The five checkout calls, bound to one transport.
 *
 * Passing no transport reproduces exactly what the free functions in
 * `client.ts` have always done: `/api/checkout/**` on the ambient `fetch`.
 */
export function createCheckoutClient(transport: CheckoutTransport = {}): CheckoutClient {
  const baseUrl = transport.baseUrl ?? DEFAULT_CHECKOUT_BASE_URL;

  /** Call a checkout route and normalize the response into a {@link Result}. */
  async function call<T>(route: string, init?: RequestInit): Promise<Result<T>> {
    // Resolved here, not captured at build time: a suite (or a story) that
    // replaces the global afterwards must still be the one that answers.
    const doFetch = transport.fetchImpl ?? ambientFetch;
    try {
      const extra = transport.headers ? await transport.headers() : undefined;
      const res = await doFetch(`${baseUrl}${route}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...extra, ...init?.headers },
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

  return {
    getConfig: (tenantSlug) =>
      call<CheckoutProviderConfig>(`/config?tenantSlug=${encodeURIComponent(tenantSlug)}`, {
        method: "GET",
      }),

    getStatus: (ref) =>
      call<OrderStatus>(
        `/status?${new URLSearchParams({ orderId: ref, ...returnedSettlement() }).toString()}`,
        { method: "GET" },
      ),

    charge: (input) =>
      call<ChargeOutcome>("/charge", { method: "POST", body: flatChargeBody(input) }),

    chargeWallet: (input) =>
      call<ChargeOutcome>("/charge", { method: "POST", body: flatWalletBody(input) }),

    listInstruments: async (tenantSlug) => {
      // Scoped to the store when known (FUT-697): only cards the store's ACTIVE
      // provider can actually charge come back — a PagBank-vaulted card is not
      // offered for a Stone charge it would fail (or misroute).
      const query = tenantSlug ? `?tenantSlug=${encodeURIComponent(tenantSlug)}` : "";
      const result = await call<SavedCard[]>(`/cards${query}`, { method: "GET" });
      return result.ok ? result.data : [];
    },

    refreshBrowserKey: (input) =>
      call<{ publicKey: string | null }>("/refresh-key", {
        method: "POST",
        body: JSON.stringify({ orderId: input.orderId }),
      }),
  };
}
