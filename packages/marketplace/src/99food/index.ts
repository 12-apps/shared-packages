import type { CancellationReason, MarketplaceAdapter } from "../core/adapter";
import {
  NINETY_NINE_FOOD_REASON_CODES,
  type NinetyNineFoodAdapterCopy,
  type NinetyNineFoodReasonCode,
} from "./copy";
import { openDeliveryCatalogue } from "./catalogue";
import { NINETY_NINE_FOOD_PROVIDER, normalizeOpenDeliveryEvent, verifyOpenDeliverySignature } from "./normalize";
import {
  openDeliveryConfirm,
  openDeliveryFetchOrder,
  openDeliveryRequestCancellation,
  type NinetyNineFoodApiBaseUrls,
} from "./outbound";
import { openDeliveryAvailability } from "./pause";

/**
 * `@12-apps/marketplace/99food` — 99Food, as one adapter on the engine.
 *
 * 99Food completed Open Delivery (Abrasel) adherence, so this adapter speaks
 * Open Delivery v1.7.1: the signed webhook, `CREATED` → fetch the order,
 * confirm, requestCancellation with the spec's codes. Everything 99Food is
 * under this folder; the engine reaches it only through the
 * {@link MarketplaceAdapter} port, and registering it is the whole cost:
 *
 * ```ts
 * import { createNinetyNineFoodAdapter } from "@12-apps/marketplace/99food";
 * import { NINETY_NINE_FOOD_ADAPTER_COPY_PT_BR } from "@12-apps/marketplace/99food/pt-BR";
 *
 * createMarketplaceEngine({
 *   …ports,
 *   adapters: [
 *     createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_PT_BR }),
 *     createNinetyNineFoodAdapter({ copy: NINETY_NINE_FOOD_ADAPTER_COPY_PT_BR, apiBaseUrl, portalUrl }),
 *   ],
 * });
 * ```
 *
 * Its webhook is the engine's one route, `POST
 * /webhooks/marketplace/:tenantSlug/NINETY_NINE_FOOD`.
 */

export { NINETY_NINE_FOOD_PROVIDER } from "./normalize";

/** How long 99Food may take to answer a cancellation request. ESTIMATED: the spec names no deadline. */
export const NINETY_NINE_FOOD_CANCELLATION_ANSWER_WINDOW_MS = 5 * 60_000;

/** The one reason that means "an item is unavailable". */
const ITEM_UNAVAILABLE: NinetyNineFoodReasonCode = "UNAVAILABLE_ITEM";

export interface NinetyNineFoodAdapterConfig {
  /** The words the adapter needs: reason labels and the missing-number text. Required. */
  copy: NinetyNineFoodAdapterCopy;
  /**
   * Where 99Food serves Open Delivery, per environment: the base the spec's
   * paths (`/oauth/token`, `/v1/orders/…`) hang from. Given to a partner at
   * onboarding and not public, so required and defaultless. https only.
   */
  apiBaseUrl: NinetyNineFoodApiBaseUrls;
  /**
   * Where "open it on 99Food" goes: the merchant portal. Open Delivery names no
   * per-order deep link, so the link is the portal. Required; https only.
   */
  portalUrl: string;
  /**
   * OPTIONAL, off by default. Offer the store pause (FUT-4851) through Open
   * Delivery's `merchantStatus`, a store-wide switch with no id: a store the
   * owner also closed by hand on 99Food during the kitchen's pause is opened
   * with it. A host turns this on knowing that.
   */
  pauseByStoreSwitch?: boolean;
}

function assertHttps(name: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`@12-apps/marketplace/99food: ${name} is not a URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`@12-apps/marketplace/99food: ${name} must be https.`);
}

/** Build the 99Food adapter. Its reasons are static: a dialog never waits on 99Food. */
export function createNinetyNineFoodAdapter(config: NinetyNineFoodAdapterConfig): MarketplaceAdapter {
  assertHttps("apiBaseUrl.SANDBOX", config.apiBaseUrl.SANDBOX);
  assertHttps("apiBaseUrl.PRODUCTION", config.apiBaseUrl.PRODUCTION);
  assertHttps("portalUrl", config.portalUrl);
  const bases = { ...config.apiBaseUrl };
  const reasons: readonly CancellationReason[] = NINETY_NINE_FOOD_REASON_CODES.map((code) => ({
    code,
    label: config.copy.reasonLabels[code],
    itemUnavailable: code === ITEM_UNAVAILABLE,
    // `outOfStockItems` is optional in the spec (see `./outbound.ts`).
    needsItems: false,
  }));
  const normalizeOptions = { missingStreetNumber: config.copy.missingStreetNumber };
  return {
    provider: NINETY_NINE_FOOD_PROVIDER,
    capabilities: {
      apiConfirm: true,
      apiCancel: true,
      // The spec lets a merchant request a cancellation before or after the
      // confirm ("rules may vary depending on the timing"); the answer says.
      cancelAfterAccept: true,
      // 202, then a CANCELLED or CANCELLATION_REQUEST_DENIED event.
      asyncCancellationOutcome: true,
      perOrderAppLink: false,
      // `OrderConfirmed.preparationTime`, in minutes.
      confirmTakesPreparationTime: true,
      cancellationAnswerWindowMs: NINETY_NINE_FOOD_CANCELLATION_ANSWER_WINDOW_MS,
    },
    normalize: normalizeOpenDeliveryEvent,
    readSignature: (header) => header("x-app-signature"),
    verifySignature: verifyOpenDeliverySignature,
    cancellationReasons: () => reasons,
    // PULL: 99Food reads the menu the host serves (`GET /v1/merchant`) and is told when it changed (FUT-4768).
    catalogue: openDeliveryCatalogue(bases),
    fetchOrder: (ctx, order) => openDeliveryFetchOrder(ctx, bases, order, normalizeOptions),
    confirm: (ctx, order, input) => openDeliveryConfirm(ctx, bases, order, input),
    requestCancellation: (ctx, order, input) => openDeliveryRequestCancellation(ctx, bases, order, input),
    appLink: () => config.portalUrl,
    ...(config.pauseByStoreSwitch ? { availability: openDeliveryAvailability(bases) } : {}),
  };
}

export {
  NINETY_NINE_FOOD_REASON_CODES,
  type NinetyNineFoodAdapterCopy,
  type NinetyNineFoodReasonCode,
} from "./copy";
export { normalizeOpenDeliveryEvent, normalizeOpenDeliveryOrder, verifyOpenDeliverySignature } from "./normalize";
export type { NinetyNineFoodApiBaseUrls } from "./outbound";
export { openDeliveryCatalogue, openDeliveryMenuDocument } from "./catalogue";
export { openDeliveryAvailability, openDeliverySetMerchantStatus } from "./pause";
