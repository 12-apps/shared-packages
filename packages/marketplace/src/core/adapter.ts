import type { MarketplaceProvider, NormalizedEvent } from "./types";

/**
 * The adapter port: everything one marketplace is, behind one shape.
 *
 * The owner's rule, which this file exists to make true: "the integration
 * engine must be the same for all integrations: iFood, Rappi, 99. Only an
 * adapter is made for each one, to connect to the base engine."
 *
 * A marketplace differs from the next in five ways that matter to a store:
 * how its deliveries look and are signed (`normalize`, `readSignature`,
 * `verifySignature`), what it lets a store answer through its API (`confirm`,
 * `requestCancellation`), which reasons a refusal may carry
 * (`cancellationReasons`), and where a person goes when the API cannot do it
 * (`appLink`). Everything else — the inbox, the clock, the SKU map, the
 * outbound bookkeeping and its retries — is the engine's and does not change
 * with the marketplace.
 *
 * What a marketplace CAN do is stated by its adapter as
 * {@link MarketplaceCapabilities} and read by the engine and the host. It is
 * never inferred from the provider's id: a branch on the id outside an adapter
 * would make the next marketplace a code change instead of an adapter.
 *
 * The HTTP client is a host port ({@link MarketplaceHttp}), handed to every
 * outbound call. An adapter never reaches the network on its own, so tests
 * answer the seam and nothing else, and the host owns the timeout, the proxy
 * and the CA.
 */

/** A marketplace's credentials, as the merchant supplies them. Sealed at rest. */
export interface MarketplaceCredentials {
  clientId: string;
  clientSecret: string;
  /**
   * The shared secret a delivery's signature is verified against. Separate
   * from the OAuth pair: a merchant rotating their webhook secret has not
   * re-onboarded.
   */
  webhookSecret: string | null;
}

/** What the host's HTTP client takes. */
export interface MarketplaceHttpRequest {
  method: "GET" | "POST" | "PUT";
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** What the host's HTTP client answers: any status, never a throw for a 4xx or 5xx. */
export interface MarketplaceHttpResponse {
  status: number;
  body: string;
}

/** The host's HTTP client. It throws only when no answer arrived (a timeout, a network error). */
export type MarketplaceHttp = (request: MarketplaceHttpRequest) => Promise<MarketplaceHttpResponse>;

/** What a marketplace can do, stated by its adapter. */
export interface MarketplaceCapabilities {
  /** Accepting is answered through the API. */
  apiConfirm: boolean;
  /** A cancellation can be requested through the API at all. */
  apiCancel: boolean;
  /** …and still once the order was accepted. */
  cancelAfterAccept: boolean;
  /** The cancellation's outcome arrives later as an event rather than in the answer. */
  asyncCancellationOutcome: boolean;
  /** `appLink` names this order, rather than only the marketplace's portal. */
  perOrderAppLink: boolean;
  /** Confirming states a preparation time. */
  confirmTakesPreparationTime: boolean;
  /**
   * OPTIONAL. How long the marketplace takes, at most, to answer a store's
   * cancellation request, in milliseconds: past it the outbound sweep fails
   * the request as TIMEOUT. Absent: only the 24-hour give-up applies.
   */
  cancellationAnswerWindowMs?: number;
}

/** One reason a store may give for refusing or cancelling an order. */
export interface CancellationReason {
  /** The marketplace's own code, sent verbatim. */
  code: string;
  /** The label the host was configured with for this code (a named pack). */
  label: string;
  /** This reason means "an item is unavailable": the host preselects it when stock is short. */
  itemUnavailable: boolean;
  /** The marketplace requires the offending SKUs with this reason. */
  needsItems: boolean;
}

/** The order an outbound call is about, as the engine knows it. */
export interface OutboundOrderRef {
  externalOrderId: string;
  externalDisplayId: string | null;
  /** The host's own id for the order. */
  hostOrderCode: string;
  /** When the engine recorded the order. */
  placedAt: Date;
}

/** A per-engine token cache an adapter reads and fills. Never persisted. */
export type AdapterTokenCache = Map<string, { token: string; expiresAt: number }>;

/** What one outbound call is handed. */
export interface AdapterCallContext {
  http: MarketplaceHttp;
  credentials: MarketplaceCredentials;
  environment: "SANDBOX" | "PRODUCTION";
  /** Written to no row, log or audit entry: memory only, per process. */
  tokens: AdapterTokenCache;
  now: Date;
}

/** One outbound call's answer, in the three shapes the engine acts on. */
export type OutboundResult =
  /** 2xx. For a marketplace whose outcome is asynchronous, "the request was taken". */
  | { kind: "accepted" }
  /** A final 4xx (not 408/425/429): never retried. */
  | { kind: "refused"; status: number; message: string }
  /** 408, 425, 429, 5xx, a timeout, a network error: retried until the last attempt. */
  | { kind: "retry"; reason: string };

/** What a cancellation request carries. */
export interface CancellationRequestInput {
  reason: CancellationReason;
  /** Free text from the store; empty means "the reason's own label". */
  text: string;
  mode: "MANUAL" | "AUTO";
  offendingSkus: readonly string[];
}

/** One marketplace, in and out. */
export interface MarketplaceAdapter {
  readonly provider: MarketplaceProvider;
  readonly capabilities: MarketplaceCapabilities;
  /** Inbound: one delivery into the canonical shape, or null when it carries no order id. */
  normalize(payload: unknown): NormalizedEvent | null;
  /** Which header carries this marketplace's signature, read off the request. */
  readSignature(header: (name: string) => string | null): string | null;
  /** Is this delivery's signature the one this store's secret would produce? */
  verifySignature(rawBody: string, signature: string | null, secret: string | null): boolean;
  /** The marketplace's documented reasons, static and offline: a dialog never waits on the network. */
  cancellationReasons(): readonly CancellationReason[];
  /** Tell the marketplace the store accepted the order. */
  confirm(
    ctx: AdapterCallContext,
    order: OutboundOrderRef,
    input: { preparationMinutes: number | null },
  ): Promise<OutboundResult>;
  /** Ask the marketplace to cancel the order, with one of its own reasons. */
  requestCancellation(
    ctx: AdapterCallContext,
    order: OutboundOrderRef,
    input: CancellationRequestInput,
  ): Promise<OutboundResult>;
  /** Where "open it on the marketplace" goes: the order when `perOrderAppLink`, else the portal. Always https. */
  appLink(order: Pick<OutboundOrderRef, "externalOrderId" | "externalDisplayId">): string;
}

/**
 * The 4xx statuses that are NOT a refusal: a request timeout (408), "too
 * early" (425) and a rate limit (429) say "ask again later" by HTTP's own
 * semantics, and a marketplace rate-limits its merchant API.
 */
const TRANSIENT_CLIENT_STATUSES = new Set([408, 425, 429]);

/**
 * Read one HTTP answer the way the engine acts on it. Shared by every adapter
 * whose API speaks plain status codes, so the rule is one rule rather than one
 * per marketplace: 2xx accepted; a 4xx other than 408/425/429 refused and
 * final; everything else (408, 425, 429, 5xx, anything unexpected) retried.
 */
export function outboundResultOf(response: MarketplaceHttpResponse): OutboundResult {
  if (response.status >= 200 && response.status < 300) return { kind: "accepted" };
  const message = response.body.slice(0, 300);
  const refusal = response.status >= 400 && response.status < 500 && !TRANSIENT_CLIENT_STATUSES.has(response.status);
  if (refusal) return { kind: "refused", status: response.status, message };
  return { kind: "retry", reason: `status ${response.status}: ${message}` };
}

/** A call that never got an answer is a retry, with the reason a log can read. */
export async function answered(call: () => Promise<OutboundResult>): Promise<OutboundResult> {
  try {
    return await call();
  } catch (error) {
    return { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
}
