import type { CancellationReason, MarketplaceAdapter } from "../core/adapter";
import {
  openDeliveryConfirm,
  openDeliveryFetchOrder,
  openDeliveryRequestCancellation,
  openDeliveryStatus,
} from "../open-delivery/orders";
import { assertHttpsUrl } from "../open-delivery/client";
import { OPEN_DELIVERY_ITEM_UNAVAILABLE } from "../open-delivery/reasons";
import { NINETY_NINE_FOOD_REASON_CODES, type NinetyNineFoodAdapterCopy } from "./copy";
import { openDeliveryCatalogue } from "./catalogue";
import { NINETY_NINE_FOOD_PROVIDER, normalizeOpenDeliveryEvent, normalizeOpenDeliveryOrder, verifyOpenDeliverySignature } from "./normalize";
import { ninetyNineFoodDialect, type NinetyNineFoodApiBaseUrls } from "./outbound";
import { openDeliveryAvailability } from "./pause";

/**
 * `@12-apps/marketplace/99food` — 99Food, as one adapter on the engine.
 *
 * 99Food completed Open Delivery (Abrasel) adherence, so this adapter speaks
 * Open Delivery v1.7.1: the signed webhook, `CREATED` → fetch the order,
 * confirm, requestCancellation with the spec's codes. The standard's calls
 * and readers are `../open-delivery/`, shared with Keeta; what is 99Food's
 * (its dialect, its copy, its ESTIMATED choices) is under this folder; the engine reaches it only through the
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

/** 99Food serves `pickedUp` for a take-out (v1.7.1). */
const STATUS = openDeliveryStatus({ takeoutPickedUp: true });

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

const assertHttps = (name: string, url: string): void => assertHttpsUrl("@12-apps/marketplace/99food", name, url);

/** Build the 99Food adapter. Its reasons are static: a dialog never waits on 99Food. */
export function createNinetyNineFoodAdapter(config: NinetyNineFoodAdapterConfig): MarketplaceAdapter {
  assertHttps("apiBaseUrl.SANDBOX", config.apiBaseUrl.SANDBOX);
  assertHttps("apiBaseUrl.PRODUCTION", config.apiBaseUrl.PRODUCTION);
  assertHttps("portalUrl", config.portalUrl);
  const dialect = ninetyNineFoodDialect({ ...config.apiBaseUrl });
  const bases = dialect.bases;
  const reasons: readonly CancellationReason[] = NINETY_NINE_FOOD_REASON_CODES.map((code) => ({
    code,
    label: config.copy.reasonLabels[code],
    itemUnavailable: code === OPEN_DELIVERY_ITEM_UNAVAILABLE,
    // `outOfStockItems` is optional in the spec, and not sent (see `cancellation` below).
    needsItems: false,
  }));
  const normalizeOptions = { missingStreetNumber: config.copy.missingStreetNumber };
  const fetchOptions = { normalize: (order: unknown) => normalizeOpenDeliveryOrder(order, normalizeOptions) };
  // `outOfStockItems` wants 99Food's item uuids; the engine keeps SKUs (`externalCode`). Not sent.
  const cancellation = { outOfStockAsSkus: false };
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
      // Open Delivery's readyForPickup, dispatch and delivered / pickedUp (`../open-delivery/orders.ts`).
      statusSteps: ["READY", "DISPATCHED", "HANDED_OVER"],
    },
    normalize: normalizeOpenDeliveryEvent,
    readSignature: (header) => header("x-app-signature"),
    verifySignature: verifyOpenDeliverySignature,
    cancellationReasons: () => reasons,
    // PULL: 99Food reads the menu the host serves (`GET /v1/merchant`) and is told when it changed (FUT-4768).
    catalogue: openDeliveryCatalogue(bases),
    fetchOrder: (ctx, order) => openDeliveryFetchOrder(ctx, dialect, order, fetchOptions),
    confirm: (ctx, order, input) => openDeliveryConfirm(ctx, dialect, order, input),
    requestCancellation: (ctx, order, input) =>
      openDeliveryRequestCancellation(ctx, dialect, order, input, cancellation),
    statusSupported: STATUS.supported,
    informStatus: (ctx, order, facts) => STATUS.inform(ctx, dialect, order, facts),
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
