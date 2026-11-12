import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { TENANT, createHarness, ifoodPlaced } from "../../__tests__/harness";
import { MARKETPLACE_SERVER_COPY_EN_US } from "../../server/en-US";
import { marketplaceRouter } from "..";

/** The Hono adapter: the descriptors mounted under `/api`, guarded by the host's resolver. */

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function mounted(allow: (permission: string | undefined) => boolean) {
  const harness = createHarness();
  const seen: (string | undefined)[] = [];
  const marketplace = marketplaceRouter({
    engine: harness.engine,
    copy: MARKETPLACE_SERVER_COPY_EN_US,
    tenantBySlug: async (slug) => (slug === "the-store" ? TENANT : null),
    logger: silent,
    resolveActor: (_c, permission) => {
      seen.push(permission);
      return allow(permission) ? { clientId: TENANT } : null;
    },
  });
  const server = new Hono();
  server.route("/api", marketplace.router);
  return { h: harness, app: server, seen };
}

describe("marketplaceRouter", () => {
  it("serves the webhook unguarded, with the raw body the signature needs", async () => {
    const { h, app, seen } = mounted(() => false);
    await h.connect();

    const response = await app.request("/api/webhooks/marketplace/the-store/IFOOD", {
      method: "POST",
      body: JSON.stringify(ifoodPlaced("ext-1")),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "ingested" });
    expect(seen).toEqual([]);
  });

  it("asks the host for the actor with the route's declared permission, and 401s a refusal", async () => {
    const { app, seen } = mounted((permission) => permission === "marketplace:decide");

    const queue = await app.request("/api/admin/the-store/marketplace/acceptances");
    const settings = await app.request("/api/admin/the-store/marketplace");

    expect(queue.status).toBe(200);
    expect(settings.status).toBe(401);
    expect(seen).toEqual(["marketplace:decide", "marketplace:manage"]);
  });

  it("passes a JSON body through and answers the handler's own status", async () => {
    const { app } = mounted(() => true);

    const response = await app.request("/api/admin/the-store/marketplace/acceptances", {
      method: "POST",
      body: JSON.stringify({ decisions: [{ orderId: "nope", decision: "ACCEPT" }] }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(409);
  });
});
