import type { OpenDeliveryApiBaseUrls, OpenDeliveryDialect } from "../open-delivery/client";
import { NINETY_NINE_FOOD_PROVIDER } from "./normalize";

/**
 * 99Food's Open Delivery DIALECT: v1.7.1 as the standard writes it. The calls
 * themselves (the grant, the order fetch, confirm, requestCancellation, the
 * status steps) are `../open-delivery/`'s; this file only says where and how
 * 99Food takes them.
 *
 * - Token: `POST /oauth/token`, form-encoded `client_id`, `client_secret`,
 *   `grant_type=client_credentials`.
 * - Bodies: plain JSON; no request signature.
 *
 * The one thing the spec cannot pin is WHERE: Open Delivery standardizes the
 * paths under each Ordering Application's own base URL, and 99Food gives its
 * base URLs to a partner at onboarding. So the base URL per environment is
 * the adapter's REQUIRED config, never a guessed default.
 */

/** Where 99Food serves Open Delivery, per environment (given at partner onboarding). */
export type NinetyNineFoodApiBaseUrls = OpenDeliveryApiBaseUrls;

/** 99Food's dialect, for the base URLs it was given. */
export function ninetyNineFoodDialect(bases: NinetyNineFoodApiBaseUrls): OpenDeliveryDialect {
  return {
    provider: NINETY_NINE_FOOD_PROVIDER,
    name: "99Food",
    bases,
    tokenGrant: (ctx) => ({
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({
        client_id: ctx.credentials.clientId,
        client_secret: ctx.credentials.clientSecret,
        grant_type: "client_credentials",
      }).toString(),
    }),
    serialize: (body) => JSON.stringify(body),
  };
}
