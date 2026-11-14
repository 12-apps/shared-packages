import { answered, outboundResultOf, type AdapterCallContext, type OutboundResult } from "../core/adapter";
import type { MarketplaceAvailability } from "../core/pause-port";
import { baseOf, bearer, tokenKey, type NinetyNineFoodApiBaseUrls } from "./outbound";

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
  return answered(async () => {
    const auth = await bearer(ctx, bases);
    if (!("token" in auth)) return auth;
    const response = await ctx.http({
      method: "POST",
      url: `${baseOf(ctx, bases)}/v1/merchantUpdate`,
      headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ merchantStatus: status }),
    });
    if (response.status !== 401) return outboundResultOf(response);
    ctx.tokens.delete(tokenKey(ctx));
    return { kind: "retry", reason: "99Food refused the token" };
  });
}

/** 99Food's availability capability: Open Delivery's merchant status, a switch. */
export function openDeliveryAvailability(bases: NinetyNineFoodApiBaseUrls): MarketplaceAvailability {
  return {
    kind: "switch",
    pause: async (ctx, request) => {
      const result = await openDeliverySetMerchantStatus(ctx, bases, "UNAVAILABLE");
      return result.kind === "accepted" ? { kind: "paused", externalId: null, until: request.until } : result;
    },
    resume: (ctx) => openDeliverySetMerchantStatus(ctx, bases, "AVAILABLE"),
  };
}
