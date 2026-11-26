import type { PullCatalogue } from "../core/catalogue-port";
import { openDeliveryMenuDocument, openDeliveryMerchantUpdate } from "../open-delivery/merchant";
import { ninetyNineFoodDialect, type NinetyNineFoodApiBaseUrls } from "./outbound";

/**
 * The 99Food adapter's CATALOGUE half, on Open Delivery v1.7.1: PULL (FUT-4768).
 *
 * In Open Delivery the store's software does not write the menu to the
 * marketplace. The SOFTWARE SERVICE (the host) serves `GET /v1/merchant`, a
 * `Merchant` document carrying `menus`, `categories`, `items` and
 * `itemOffers`, and the ORDERING APPLICATION (99Food) pulls it, again when its
 * `TTL` runs out or when told the merchant changed (`POST
 * /v1/merchantUpdate`, sent with an empty body: "pull everything again").
 * Spec: https://abrasel-nacional.github.io/opendelivery/openapi.yaml
 *
 * So the adapter does two things: build the menu part of that document from
 * the items the store switched on (`menuDocument`, pure, shared:
 * `../open-delivery/merchant.ts`; the host merges it into the rest of the
 * `Merchant`, which is its own: `basicInfo`, `services`, `lastUpdate`, `TTL`,
 * `status`), and tell 99Food the menu changed (`notifyMenuChanged`).
 *
 * ESTIMATED, to be checked once 99Food grants partner access:
 * - the path: the spec's route table and prose name `POST /merchantUpdate`
 *   (`/v1/merchantUpdate`), while its path key is `/v1/menuUpdated`; this
 *   sends the prose's;
 * - the `X-App-MerchantId` header on it: the operation lists none, and one
 *   client app may serve many merchants, so it is sent to name which;
 * - that 99Food reads the whole `Merchant` on that notification (scenario 1
 *   of the operation) rather than needing `entityType`/`updatedObjects`.
 */

export { openDeliveryMenuDocument } from "../open-delivery/merchant";

/** 99Food's catalogue capability, for the base URLs it was given. */
export function openDeliveryCatalogue(bases: NinetyNineFoodApiBaseUrls): PullCatalogue {
  const dialect = ninetyNineFoodDialect(bases);
  return {
    mode: "pull",
    menuDocument: openDeliveryMenuDocument,
    // No body: 99Food pulls the whole `Merchant` again. 200 or 204.
    notifyMenuChanged: (ctx) =>
      openDeliveryMerchantUpdate(ctx, dialect, {
        path: "/v1/merchantUpdate",
        headers: { "X-App-MerchantId": ctx.externalMerchantId },
      }),
  };
}
