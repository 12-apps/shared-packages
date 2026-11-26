import { describe, expect, it } from "vitest";

import type { WireResponse, WireRoute } from "@12-apps/wiring";

import { TENANT, createHarness, type Harness } from "../../__tests__/harness";
import { createApiMarketplace, type MarketplaceActor } from "..";
import { MARKETPLACE_SERVER_COPY_EN_US } from "../en-US";

/**
 * A SKU mapped to one variation over HTTP (FUT-4927): the strict PUT schema
 * takes `variationId`, the engine stores it, and the answer carries it back.
 */

const BASE = "/admin/:tenantSlug/marketplace";
type Problem = { path: (string | number)[]; code: string; message: string };

async function put(h: Harness, body: unknown): Promise<WireResponse> {
  const api = createApiMarketplace({
    engine: h.engine,
    copy: MARKETPLACE_SERVER_COPY_EN_US,
    tenantBySlug: async (slug) => (slug === "the-store" ? TENANT : null),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
  const target = api.routes.find((candidate) => candidate.method === "PUT" && candidate.path === `${BASE}/menu-links`);
  if (!target) throw new Error("no PUT menu-links route");
  return (target as WireRoute<MarketplaceActor>).handle({
    actor: { clientId: TENANT, userId: "user-1" },
    params: { tenantSlug: "the-store" },
    query: {},
    body,
  });
}

describe("PUT menu-links with a variation", () => {
  it("maps a SKU to a variation, answers it in links[], and names a foreign variation's path", async () => {
    const h = createHarness();
    h.catalog.add("menu-1#var-1");

    const mapped = await put(h, { links: [{ provider: "IFOOD", externalSku: "SKU-1", menuItemId: "menu-1", variationId: "var-1" }] });
    const foreign = await put(h, { links: [{ provider: "IFOOD", externalSku: "SKU-2", menuItemId: "menu-1", variationId: "var-x" }] });

    expect(mapped.status).toBe(200);
    expect((mapped.body as { data: { links: unknown[] } }).data.links).toEqual([
      expect.objectContaining({ externalSku: "SKU-1", menuItemId: "menu-1", variationId: "var-1" }),
    ]);
    expect(h.memory.tables.marketplaceMenuLink.rows).toEqual([expect.objectContaining({ externalSku: "SKU-1", variationId: "var-1" })]);
    expect(foreign.status).toBe(422);
    expect((foreign.body as { problems: Problem[] }).problems).toEqual([
      { path: ["links", 0, "variationId"], code: "CATALOG_ITEM_NOT_FOUND", message: MARKETPLACE_SERVER_COPY_EN_US.problems.CATALOG_ITEM_NOT_FOUND },
    ]);
  });
});
