import { z } from "zod";

import type { WireMcpTool } from "@12-apps/wiring";

/**
 * The linking tools (FUT-5613), one per linking route, authored once and
 * reused as the routes' validators. Every input is STRICT. No answer carries a
 * token, a verifier or the app's credentials.
 */

const provider = z.string().regex(/^[A-Z][A-Z0-9_]*$/u);
const environment = z.enum(["SANDBOX", "PRODUCTION"]);

/** Whether linking is available, and the code in progress. */
export const linkStateQuery = z.strictObject({ provider, environment: environment.optional() });
/** Start a linking: a new portal code. */
export const startLinkBody = z.strictObject({ provider, environment: environment.optional() });
/** Finish it with the authorization code the person pasted. */
export const finishLinkBody = z.strictObject({
  provider,
  authorizationCode: z.string().trim().min(1).max(512),
  enabled: z.boolean().optional(),
});
/** The marketplace stores a linked connection's grant covers. */
export const linkMerchantsQuery = z.strictObject({ provider });
/** Which of them this store is. */
export const selectLinkMerchantBody = z.strictObject({ provider, merchantId: z.string().trim().min(1).max(200) });

const pendingSchema = z.object({
  userCode: z.string(),
  verificationUrl: z.string(),
  verificationUrlComplete: z.string(),
  expiresAt: z.string(),
});

const merchantSchema = z.object({ id: z.string(), name: z.string().nullable(), corporateName: z.string().nullable() });

const BASE = "/admin/{tenantSlug}/marketplace/link";

/** The five linking tools, over the connection schema the connection tools answer. */
export function marketplaceLinkTools<P extends z.ZodType, I extends z.ZodType>(params: P, integration: I) {
  return [
    {
      operationId: "getMarketplaceLink",
      method: "GET",
      path: BASE,
      summary:
        "Read in one call whether a store can connect a marketplace through the software's own app (no credentials typed), and the portal code still in progress, if any: `userCode`, the portal link that already carries it, and when it expires.",
      tags: ["marketplace"],
      params,
      query: linkStateQuery,
      response: z.object({ data: z.object({ available: z.boolean(), pending: pendingSchema.nullable() }) }),
      annotations: { readOnly: true },
    },
    {
      operationId: "listMarketplaceLinkMerchants",
      method: "GET",
      path: `${BASE}/merchants`,
      summary: "List the marketplace stores a linked connection's authorization covers, to choose which one this store is.",
      tags: ["marketplace"],
      params,
      query: linkMerchantsQuery,
      response: z.object({ data: z.array(merchantSchema) }),
      annotations: { readOnly: true, openWorld: true },
    },
    {
      operationId: "startMarketplaceLink",
      method: "POST",
      path: `${BASE}/start`,
      summary:
        "Start connecting a marketplace through the software's own app in one call: answers the code the person types on the marketplace's portal and the portal link that already carries it (valid ten minutes on iFood). Replaces a code in progress. 409 UNAVAILABLE when the software has no app on that marketplace.",
      tags: ["marketplace"],
      params,
      body: startLinkBody,
      response: z.object({ data: pendingSchema }),
      annotations: { readOnly: false, destructive: false, openWorld: true },
    },
    {
      operationId: "finishMarketplaceLink",
      method: "POST",
      path: `${BASE}/finish`,
      summary:
        "Finish connecting, in one call, with the authorization code the marketplace's portal showed the person. Stores the connection as LINKED and selects the marketplace store when the authorization covers only one; `merchants` lists them (null when they could not be listed). 422 CODE_REFUSED for a wrong code (the code in progress stays, paste again); 409 LINK_EXPIRED past its ten minutes.",
      tags: ["marketplace"],
      params,
      body: finishLinkBody,
      response: z.object({ data: z.object({ integration, merchants: z.array(merchantSchema).nullable() }) }),
      annotations: { readOnly: false, destructive: false, openWorld: true },
    },
    {
      operationId: "selectMarketplaceLinkMerchant",
      method: "PUT",
      path: `${BASE}/merchant`,
      summary:
        "Choose in one call which marketplace store a linked connection is, among those its authorization covers. 422 UNKNOWN_MERCHANT for one it does not cover; 409 MERCHANT_TAKEN when another store's connection holds it.",
      tags: ["marketplace"],
      params,
      body: selectLinkMerchantBody,
      response: z.object({ data: z.object({ integration }) }),
      annotations: { readOnly: false, destructive: false, openWorld: true },
    },
  ] as const satisfies readonly WireMcpTool<z.ZodType>[];
}
