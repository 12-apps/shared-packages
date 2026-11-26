import type { OpenDeliveryApiBaseUrls, OpenDeliveryDialect } from "../open-delivery/client";
import { KEETA_PROVIDER } from "./normalize";
import { canonicalJson, keetaRequestSignature } from "./signature";

/**
 * Keeta's Open Delivery DIALECT. Keeta follows Open Delivery v1.5.0 with
 * changes of its own, and "the definitions of this document prevail"
 * (https://api-docs.mykeeta.com/apis/opendelivery/general-info, read
 * 2026-11-26). The calls are `../open-delivery/`'s; this file says how Keeta
 * takes them:
 *
 * - Token: `POST /oauth/token` with a JSON body `{ client_id, client_secret,
 *   grant_type: "app_level_token" }` (v1.0.9's name for the standard's
 *   `client_credentials`, which stays accepted for integrations already
 *   certified). The token is the APPLICATION's: one for every store that
 *   authorized it, so the cache key (provider, environment, client id) is
 *   right as it is. Answer `{ access_token, token_type, expires_in }`; no
 *   refresh token in this mode.
 * - Every request, the grant included, carries `X-App-Signature`
 *   (`./signature.ts`), and every JSON body is RFC 8785 canonical.
 */

/** Where Keeta serves Open Delivery, per environment. */
export type KeetaApiBaseUrls = OpenDeliveryApiBaseUrls;

/**
 * The documented server (`servers[0]` of Keeta's `openapi.json`). ESTIMATED
 * for SANDBOX: Keeta documents one host, and a test application (its own
 * client id and secret, its test stores) is what makes a session a test one.
 */
export const KEETA_API_BASE_URL = "https://open.mykeeta.com/api/open/opendelivery";

export const KEETA_DEFAULT_API_BASE_URLS: KeetaApiBaseUrls = {
  SANDBOX: KEETA_API_BASE_URL,
  PRODUCTION: KEETA_API_BASE_URL,
};

/** Keeta's dialect, for the base URLs it was given. */
export function keetaDialect(bases: KeetaApiBaseUrls): OpenDeliveryDialect {
  return {
    provider: KEETA_PROVIDER,
    name: "Keeta",
    bases,
    tokenGrant: (ctx) => ({
      contentType: "application/json",
      body: canonicalJson({
        client_id: ctx.credentials.clientId,
        client_secret: ctx.credentials.clientSecret,
        grant_type: "app_level_token",
      }),
    }),
    serialize: canonicalJson,
    sign: (ctx, url, body) => ({ "X-App-Signature": keetaRequestSignature(url, body, ctx.credentials.clientSecret) }),
  };
}
