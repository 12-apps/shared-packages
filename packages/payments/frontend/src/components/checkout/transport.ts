/**
 * The checkout's HTTP transport, as a bound client (FUT-741).
 *
 * Everything `client.ts` used to do with a hard-coded prefix and the ambient
 * `fetch` now lives here behind {@link createCheckoutClient}, so the same
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

import type { BuyerVaultSession, VaultedCardDisplay } from "@12-apps/payments-backend";

import type { SavedCard } from "../../card";
import { err, ok, type Result } from "../../result";

import type { CheckoutTransportCopy } from "./screens-copy";

import type {
  ChargeCardInput,
  ChargeOutcome,
  ChargeWalletInput,
  CheckoutProviderConfig,
  OrderStatus,
} from "./types";

/**
 * The two buyer-vault answer shapes (FUT-478/FUT-183), imported as TYPES from
 * the backend package rather than mirrored: `/cards/begin` and `/cards/complete`
 * are new rows with no older-host degrade story to encode, so a mirror here
 * would only be a copy that can drift from the wire it names. Re-exported for
 * the same reason `PaymentEnvironment` is on the barrel — a host typing its
 * own callback must not need a direct backend dependency.
 */
export type { BuyerVaultSession, VaultedCardDisplay };

/**
 * The browser's two legitimate contributions to `POST /cards/complete`: the
 * session it confirmed, and — for a sessionless PUBLIC_KEY provider — the
 * encrypted card blob. The ownership facts (`reference`, `customerRef`) are
 * answered server-side by the host's vault port and are NOT here on purpose:
 * a body naming them is ignored by the mount.
 */
export interface CompleteVaultInput {
  sessionId?: string;
  token?: string;
}

/**
 * The prefix every shipped buyer checkout posts to today. Exported so a host
 * (or a test) can state it rather than re-type it, and so a change to it is a
 * change to one named constant with this comment attached.
 */
export const DEFAULT_CHECKOUT_BASE_URL = "/api/checkout";

/** Where the `createPaymentFlowsBE` mount lives, and how to reach it. */
export interface CheckoutTransport {
  /**
   * What the buyer reads when the WIRE failed and the server sent no sentence
   * of its own (FUT-760) — required, and with no default.
   *
   * Three sentences, and only one of them is common: `offline`, which is what
   * a buyer on a dropped connection sees. That is exactly why it may not be
   * this package's Portuguese — it is the failure most likely to be the first
   * thing an adopter's shopper ever reads from us.
   */
  copy: CheckoutTransportCopy;
  /**
   * Prefix for `/config`, `/status`, `/charge`, `/cards`, `/cards/begin`,
   * `/cards/complete`, `/refresh-key`.
   */
  baseUrl?: string;
  /**
   * The `fetch` to call. Omitted ⇒ the ambient one, resolved PER CALL so a
   * suite that stubs the global after the client was built still sees its stub.
   */
  fetchImpl?: typeof fetch;
  /** Extra headers per request (a bearer token, a tenant header). */
  headers?: () => HeadersInit | Promise<HeadersInit>;
}

/**
 * A transport whose WORDS some surrounding config already answers.
 *
 * `createPaymentFlows` takes one: its `copy` covers the whole checkout, so
 * asking a host to repeat the three transport sentences beside `fetchImpl`
 * would be the same question twice. Naming `copy` here still wins, for a mount
 * that talks to a different surface in a different voice.
 */
export type CheckoutTransportBinding = Omit<CheckoutTransport, "copy"> &
  Partial<Pick<CheckoutTransport, "copy">>;

/** The nine calls the buyer checkout makes, pre-bound to a {@link CheckoutTransport}. */
export interface CheckoutClient {
  getConfig(tenantSlug: string): Promise<Result<CheckoutProviderConfig>>;
  getStatus(ref: string): Promise<Result<OrderStatus>>;
  /**
   * `POST /release` (FUT-1146): the buyer says they did not pay, and the
   * charge they were sent away for has no terminal state of its own.
   *
   * Answers the payable's status AFTER the server has re-asked the provider,
   * so a payment that actually succeeded comes back `PAID` and nothing is
   * released — the race against a late webhook resolves in the shopper's
   * favour rather than against it.
   */
  releaseCheckout(input: { orderId: string }): Promise<Result<OrderStatus>>;
  charge(input: ChargeCardInput): Promise<Result<ChargeOutcome>>;
  /** A wallet instrument against the same `/charge` route (FUT-471/472). */
  chargeWallet(input: ChargeWalletInput): Promise<Result<ChargeOutcome>>;
  listInstruments(tenantSlug?: string): Promise<SavedCard[]>;
  /**
   * `POST /cards/begin` (FUT-478): equip the browser to mint an instrument
   * OUTSIDE a purchase. The answer names the tokenization scheme, the public
   * key when the provider has one, and the session to echo to `completeVault`.
   */
  beginVault(): Promise<Result<BuyerVaultSession>>;
  /**
   * `POST /cards/complete`: the provider accepted the card — the server stores
   * the vault token against the caller and answers DISPLAY metadata only. The
   * token that can charge never reaches the browser.
   */
  completeVault(input: CompleteVaultInput): Promise<Result<VaultedCardDisplay>>;
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
function refused<T>(json: ApiEnvelope<T> | null, copy: CheckoutTransportCopy): Result<T> {
  return err(json?.error ?? copy.failed, json?.code);
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
 * The wire body of `POST /cards/complete` — ONLY the browser's two facts, and
 * each present only when it exists. `flows-vault.ts` reads exactly these two
 * string fields (`browserVaultFacts`) and ignores everything else, so a field
 * added here without a backend reader would be silently dropped.
 */
function completeVaultBody(input: CompleteVaultInput): string {
  return JSON.stringify({
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.token ? { token: input.token } : {}),
  });
}

/**
 * The checkout calls, bound to one transport.
 *
 * `baseUrl` and `fetchImpl` still default to what the free functions in
 * `client.ts` have always done — `/api/checkout/**` on the ambient `fetch`.
 * `copy` does NOT default, because there is no language this package could
 * pick that would be right for the next host (FUT-760).
 */
export function createCheckoutClient(transport: CheckoutTransport): CheckoutClient {
  const baseUrl = transport.baseUrl ?? DEFAULT_CHECKOUT_BASE_URL;
  const copy = transport.copy;

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
      if (!res.ok) return refused(json, copy);
      if (!json || json.data === undefined) {
        return err(json?.error ?? copy.invalidResponse);
      }
      return ok(json.data);
    } catch {
      return err(copy.offline);
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

    releaseCheckout: (input) =>
      // The settlement hints ride in the QUERY, exactly as the poll's do: they
      // are the only way a hosted provider can be asked anything at all, so a
      // release must carry them or the server decides "not paid" from a
      // question it was never able to put.
      call<OrderStatus>(`/release?${new URLSearchParams(returnedSettlement()).toString()}`, {
        method: "POST",
        body: JSON.stringify({ orderId: input.orderId }),
      }),

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

    beginVault: () => call<BuyerVaultSession>("/cards/begin", { method: "POST" }),

    completeVault: (input) =>
      call<VaultedCardDisplay>("/cards/complete", {
        method: "POST",
        body: completeVaultBody(input),
      }),

    refreshBrowserKey: (input) =>
      call<{ publicKey: string | null }>("/refresh-key", {
        method: "POST",
        body: JSON.stringify({ orderId: input.orderId }),
      }),
  };
}
