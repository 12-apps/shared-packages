import type { AdapterCallContext, OutboundResult } from "../core/adapter";
import type { MarketplaceAvailability } from "../core/pause-port";
import { openDeliveryMerchantUpdate, openDeliverySwitchAvailability } from "../open-delivery/merchant";
import { ninetyNineFoodDialect, type NinetyNineFoodApiBaseUrls } from "./outbound";

/**
 * 99Food's half of the store pause (FUT-4851), on Open Delivery v1.7.1: the
 * software PUSHES the merchant's status to the Ordering Application.
 *
 * `POST /v1/merchantUpdate` (host: the Ordering Application, OAuth2 `od.all`)
 * "sent with only the `merchantStatus` field ... will force the opening or
 * closing of the merchant within the Ordering Application"; `merchantStatus`
 * is `AVAILABLE | UNAVAILABLE`, "only use this type when you must close
 * (disable) the merchant due to an unexpected event and you don't know when
 * the service will be re-established"; 204 (200 "for compatibility"), 400,
 * 401, 403, 404, 503 (openapi.yaml v1.7.1, README "Pausing a store").
 *
 * A SWITCH, with no id and no end, so offered only when the host opts in
 * (`pauseByStoreSwitch`; see `../core/pause-port.ts`). ESTIMATED: the path
 * (the spec files this webhook under the key `/v1/menuUpdated` while its own
 * description and route table say `POST /v1/merchantUpdate`; the latter is
 * sent), that 99Food implements it at all, and that the token names the
 * merchant (Open Delivery authenticates per merchant, so the body names none).
 */

/** Set the merchant's status. */
export function openDeliverySetMerchantStatus(
  ctx: AdapterCallContext,
  bases: NinetyNineFoodApiBaseUrls,
  status: "AVAILABLE" | "UNAVAILABLE",
): Promise<OutboundResult> {
  return openDeliveryMerchantUpdate(ctx, ninetyNineFoodDialect(bases), {
    path: "/v1/merchantUpdate",
    body: { merchantStatus: status },
  });
}

/** 99Food's availability capability: Open Delivery's merchant status, a switch. */
export function openDeliveryAvailability(bases: NinetyNineFoodApiBaseUrls): MarketplaceAvailability {
  return openDeliverySwitchAvailability((ctx, _merchantId, status) => openDeliverySetMerchantStatus(ctx, bases, status));
}
