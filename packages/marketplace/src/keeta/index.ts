import type { AdapterCallContext, CancellationReason, MarketplaceAdapter } from "../core/adapter";
import { assertHttpsUrl } from "../open-delivery/client";
import {
  openDeliveryConfirm,
  openDeliveryFetchOrder,
  openDeliveryRequestCancellation,
  openDeliveryStatus,
} from "../open-delivery/orders";
import { OPEN_DELIVERY_ITEM_UNAVAILABLE } from "../open-delivery/reasons";
import { keetaAuthorization, type KeetaAuthorization } from "./authorization";
import { KEETA_REASON_CODES, type KeetaAdapterCopy } from "./copy";
import { keetaAvailability, keetaCatalogue } from "./merchant";
import { KEETA_PROVIDER, normalizeKeetaEvent, normalizeKeetaOrder, revealKeetaOrder } from "./normalize";
import { KEETA_DEFAULT_API_BASE_URLS, keetaDialect, type KeetaApiBaseUrls } from "./outbound";
import { verifyKeetaSignature } from "./signature";

/**
 * `@12-apps/marketplace/keeta` — Keeta, as one adapter on the engine.
 *
 * Keeta's API is Open Delivery v1.5.0 with Keeta's own changes
 * (https://api-docs.mykeeta.com/apis/opendelivery, `openapi.json` "v.1.0.7"
 * with the changelog to 1.0.9, read 2026-11-26), so the adapter is built on
 * the same Open Delivery module as 99Food's (`../open-delivery/`), which
 * speaks v1.7.1. What Keeta does differently, and where it is handled:
 *
 * | Keeta | 99Food (v1.7.1) | handled in |
 * |---|---|---|
 * | `X-App-Signature` on EVERY request: Base64 HMAC-SHA256 of URL + sorted query + RFC 8785 body, keyed by the client secret | no request signature | `./signature.ts`, `./outbound.ts` |
 * | webhook signature Base64 | lowercase hex | `./signature.ts` |
 * | token: JSON `grant_type: app_level_token`, one token per APPLICATION (every authorized store) | form-encoded `client_credentials` | `./outbound.ts` |
 * | merchant authorization by the software: authorization URL, authorized stores, onboarding, authorization webhook | none | `./authorization.ts` |
 * | `merchantUpdate/{merchantId}` (path names the merchant) | `merchantUpdate` | `./merchant.ts` |
 * | menu: full reload only (`ITEM_OFFER`/`OPTION` status excepted) | full reload | `./merchant.ts` |
 * | personal data encrypted (`ENC_…`), `batchDecrypt` for a merchant's own delivery | plain | `./normalize.ts` |
 * | no `CANCELLATION_REQUEST_DENIED`: a refused request is silent, so it ends TIMEOUT | the denial event | `./normalize.ts`, the answer window below |
 * | `outOfStockItems` carries the PDV codes (`externalCode`) | item uuids, not sent | `../open-delivery/orders.ts` option |
 * | no take-out: no `pickedUp`; `delivered` only for the merchant's bag | `pickedUp` for a take-out | `../open-delivery/orders.ts` option |
 * | one public base URL and portal | given at onboarding | defaults below |
 *
 * ```ts
 * import { createKeetaAdapter } from "@12-apps/marketplace/keeta";
 * import { KEETA_ADAPTER_COPY_PT_BR } from "@12-apps/marketplace/keeta/pt-BR";
 *
 * createMarketplaceEngine({ …ports, adapters: [createKeetaAdapter({ copy: KEETA_ADAPTER_COPY_PT_BR })] });
 * ```
 *
 * Its webhook is the engine's one route, `POST
 * /webhooks/marketplace/:tenantSlug/KEETA`, registered per store as
 * `ordersWebhookURL` at onboarding.
 */

export { KEETA_PROVIDER } from "./normalize";

/**
 * How long Keeta may take to answer a cancellation request. ESTIMATED: Keeta
 * names none, and sends no event for a refusal, so past this the request is
 * failed as TIMEOUT. Keeta's own clock is 5 minutes for the acceptance.
 */
export const KEETA_CANCELLATION_ANSWER_WINDOW_MS = 5 * 60_000;

/** Where "open it on Keeta" goes by default: the Merchant Portal (Keeta names no per-order link). */
export const KEETA_PORTAL_URL = "https://merchant.mykeeta.com/";

/** Keeta has no take-out (`PICKED_UP` "is not sent"), so no `pickedUp`. */
const STATUS = openDeliveryStatus({ takeoutPickedUp: false });

export interface KeetaAdapterConfig {
  /** The words the adapter needs: reason labels and the missing-number text. Required. */
  copy: KeetaAdapterCopy;
  /** OPTIONAL. Where Keeta serves Open Delivery, per environment. Default: the documented server for both. https only. */
  apiBaseUrl?: KeetaApiBaseUrls;
  /** OPTIONAL. Where "open it on Keeta" goes. Default: the Merchant Portal. https only. */
  portalUrl?: string;
  /**
   * OPTIONAL, off by default. Offer the store pause (FUT-4851) through
   * `merchantStatus`, a store-wide switch with no id: a store the owner also
   * closed by hand on Keeta during the kitchen's pause is opened with it.
   */
  pauseByStoreSwitch?: boolean;
}

const assertHttps = (name: string, url: string): void => assertHttpsUrl("@12-apps/marketplace/keeta", name, url);

/** The Keeta API base URLs a config names, checked. */
function basesOf(config: Pick<KeetaAdapterConfig, "apiBaseUrl">): KeetaApiBaseUrls {
  const bases = { ...(config.apiBaseUrl ?? KEETA_DEFAULT_API_BASE_URLS) };
  assertHttps("apiBaseUrl.SANDBOX", bases.SANDBOX);
  assertHttps("apiBaseUrl.PRODUCTION", bases.PRODUCTION);
  return bases;
}

/** Build the Keeta adapter. Its reasons are static: a dialog never waits on Keeta. */
export function createKeetaAdapter(config: KeetaAdapterConfig): MarketplaceAdapter {
  const dialect = keetaDialect(basesOf(config));
  const portalUrl = config.portalUrl ?? KEETA_PORTAL_URL;
  assertHttps("portalUrl", portalUrl);
  const reasons: readonly CancellationReason[] = KEETA_REASON_CODES.map((code) => ({
    code,
    label: config.copy.reasonLabels[code],
    itemUnavailable: code === OPEN_DELIVERY_ITEM_UNAVAILABLE,
    // `outOfStockItems` is optional: sent when the store named the SKUs, never required.
    needsItems: false,
  }));
  const normalizeOptions = { missingStreetNumber: config.copy.missingStreetNumber };
  const fetchOptions = {
    normalize: (order: unknown) => normalizeKeetaOrder(order, normalizeOptions),
    prepare: (ctx: AdapterCallContext, order: unknown) => revealKeetaOrder(ctx, dialect, order),
  };
  // Keeta's own example sends PDV codes in `outOfStockItems` ("PDV-1002"). ESTIMATED that it reads them so.
  const cancellation = { outOfStockAsSkus: true };
  return {
    provider: KEETA_PROVIDER,
    capabilities: {
      apiConfirm: true,
      apiCancel: true,
      // "The merchant may cancel up to 48 h after the conclusion"; the answer is Keeta's.
      cancelAfterAccept: true,
      // 202 ("received for analysis"), then CANCELLED, or nothing at all.
      asyncCancellationOutcome: true,
      perOrderAppLink: false,
      // `OrderConfirmed.preparationTime`, in minutes.
      confirmTakesPreparationTime: true,
      cancellationAnswerWindowMs: KEETA_CANCELLATION_ANSWER_WINDOW_MS,
      // readyForPickup, dispatch (merchant's bag) and delivered (merchant's bag).
      statusSteps: ["READY", "DISPATCHED", "HANDED_OVER"],
    },
    normalize: normalizeKeetaEvent,
    readSignature: (header) => header("x-app-signature"),
    verifySignature: verifyKeetaSignature,
    cancellationReasons: () => reasons,
    // PULL: Keeta reads the menu the host serves (`GET /v1/merchant`) and is told when it changed.
    catalogue: keetaCatalogue(dialect),
    fetchOrder: (ctx, order) => openDeliveryFetchOrder(ctx, dialect, order, fetchOptions),
    confirm: (ctx, order, input) => openDeliveryConfirm(ctx, dialect, order, input),
    requestCancellation: (ctx, order, input) =>
      openDeliveryRequestCancellation(ctx, dialect, order, input, cancellation),
    statusSupported: STATUS.supported,
    informStatus: (ctx, order, facts) => STATUS.inform(ctx, dialect, order, facts),
    appLink: () => portalUrl,
    ...(config.pauseByStoreSwitch ? { availability: keetaAvailability(dialect) } : {}),
  };
}

/** The self-serve merchant authorization calls (`./authorization.ts`), for the same base URLs as the adapter. */
export function createKeetaAuthorization(config: Pick<KeetaAdapterConfig, "apiBaseUrl"> = {}): KeetaAuthorization {
  return keetaAuthorization(keetaDialect(basesOf(config)));
}

export { KEETA_REASON_CODES, type KeetaAdapterCopy, type KeetaReasonCode } from "./copy";
export { normalizeKeetaEvent, normalizeKeetaOrder } from "./normalize";
export { canonicalJson, keetaRequestSignature, verifyKeetaSignature } from "./signature";
export { KEETA_API_BASE_URL, type KeetaApiBaseUrls } from "./outbound";
export {
  KEETA_AUTHORIZATION_WEBHOOK_ANSWER,
  normalizeKeetaAuthorizationEvent,
  type KeetaAuthorization,
  type KeetaAuthorizationEvent,
  type KeetaAuthorizationResult,
  type KeetaAuthorizedShop,
  type KeetaAuthorizedShops,
  type KeetaOnboarding,
} from "./authorization";
