import type { AdapterCallContext, OutboundResult } from "../core/adapter";
import type { PullCatalogue } from "../core/catalogue-port";
import type { MarketplaceAvailability } from "../core/pause-port";
import type { OpenDeliveryDialect } from "../open-delivery/client";
import {
  openDeliveryMenuDocument,
  openDeliveryMerchantUpdate,
  openDeliverySwitchAvailability,
} from "../open-delivery/merchant";

/**
 * Keeta's MERCHANT half: the menu (FUT-4768) and the store pause (FUT-4851),
 * both on `POST /v1/merchantUpdate/{merchantId}` (Keeta's path names the
 * merchant, by the SOFTWARE's id; the standard's names none). Read
 * 2026-11-26 at https://api-docs.mykeeta.com/apis/opendelivery/merchantendpoints/merchantupdate.
 *
 * MENU. Keeta's menu API takes the store's menu three ways: an empty body
 * ("Keeta calls your `GET /v1/merchant` and reloads everything"),
 * `merchantStatus` alone, or `entityType` + `updatedObjects`. Of the last,
 * only `ITEM_OFFER` and `OPTION` are applied as sent, and only their
 * `status`; `MENU`, `CATEGORY`, `ITEM`… still make Keeta pull the whole menu
 * ("only full-menu update"). So a product cannot be PUSHED to Keeta: its
 * name, photo and price reach Keeta only through the `Merchant` document the
 * host serves. The adapter is therefore PULL: `menuDocument` builds the menu
 * part of that document (shared with 99Food: every item `UN` with a status,
 * every offer with `originalValue`, which Keeta requires), and
 * `notifyMenuChanged` sends the empty-body update that makes Keeta pull it.
 *
 * What Keeta reads of the rest of the `Merchant`, the host's to serve (Keeta's
 * `getMerchant` page): `id`, `status`, `basicInfo.contactEmails` (up to 3) and
 * `basicInfo.contactPhones.commercialNumber` (required), `services[]` with
 * `serviceType: DELIVERY` (the only one Keeta uses), `menuId` and
 * `serviceHours` in UTC; `lastUpdate`, `TTL` and the offers' `currency` are
 * ignored. The document's URL is registered per merchant at onboarding
 * (`./authorization.ts`).
 *
 * PAUSE. `{ merchantStatus: "UNAVAILABLE" | "AVAILABLE" }` closes or opens the
 * store, with no end and no id: a switch, offered only when the host opts in.
 * Answer 204; 400, 401, 503.
 *
 * ESTIMATED: that an update sent with no body (no `Content-Type` either) is
 * read as the documented "empty body"; that the menu is PUBLISHED once Keeta
 * took the notification, not once it read the menu (as for 99Food).
 */

const merchantUpdatePath = (merchantId: string): string => `/v1/merchantUpdate/${encodeURIComponent(merchantId)}`;

/** Keeta's catalogue capability. */
export function keetaCatalogue(dialect: OpenDeliveryDialect): PullCatalogue {
  return {
    mode: "pull",
    menuDocument: openDeliveryMenuDocument,
    notifyMenuChanged: (ctx) => openDeliveryMerchantUpdate(ctx, dialect, { path: merchantUpdatePath(ctx.externalMerchantId) }),
  };
}

/** Open or close the store on Keeta. */
function keetaSetMerchantStatus(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  merchantId: string,
  status: "AVAILABLE" | "UNAVAILABLE",
): Promise<OutboundResult> {
  return openDeliveryMerchantUpdate(ctx, dialect, { path: merchantUpdatePath(merchantId), body: { merchantStatus: status } });
}

/** Keeta's availability capability: `merchantStatus`, a switch. */
export function keetaAvailability(dialect: OpenDeliveryDialect): MarketplaceAvailability {
  return openDeliverySwitchAvailability((ctx, merchantId, status) => keetaSetMerchantStatus(ctx, dialect, merchantId, status));
}
