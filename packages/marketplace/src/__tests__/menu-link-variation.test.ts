import { readdirSync, readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

import { TENANT, createHarness, deliverIfood, ifoodPlaced } from "./harness";

/**
 * A marketplace SKU mapped to ONE variation of a catalog item (FUT-4927): the
 * link carries the variation beside the item, the bulk write asks the host
 * whether the variation is the item's, ingest hands it to the host on the line,
 * and a mapping to the item alone behaves exactly as it did before.
 */

/* eslint-disable test-flakiness/no-unmocked-fs, test-flakiness/no-database-operations, test-flakiness/no-test-isolation --
   The migration case reads the committed SQL and runs it on a real database,
   booted in-memory inside the case; the other cases use the harness's own
   in-memory fake, built per case. */

vi.setConfig({ testTimeout: 60_000 });

const IFOOD = "IFOOD";

function harnessWithVariation(options: { variations?: boolean } = {}) {
  const h = createHarness(options);
  h.catalog.add("menu-1#var-1");
  return h;
}

describe("a SKU mapped to a variation", () => {
  it("stores the variation with the item, and ingest hands both to the host on the line", async () => {
    const h = harnessWithVariation();
    await h.connect();
    const saved = await h.engine.upsertMenuLinks({
      clientId: TENANT,
      rows: [{ provider: IFOOD, externalSku: "SKU-1", menuItemId: "menu-1", variationId: "var-1" }],
    });

    await deliverIfood(h, ifoodPlaced("ext-1"));

    expect(saved).toMatchObject({ kind: "saved", rows: [{ externalSku: "SKU-1", menuItemId: "menu-1", variationId: "var-1" }] });
    expect(h.created[0]?.lines).toEqual([
      expect.objectContaining({ externalSku: "SKU-1", subjectRef: "menu-1", variationRef: "var-1" }),
    ]);
    expect(await h.engine.menuLinks({ clientId: TENANT })).toEqual([
      expect.objectContaining({ externalSku: "SKU-1", menuItemId: "menu-1", variationId: "var-1" }),
    ]);
  });

  it("maps to the item alone exactly as before: no variation on the link or the line", async () => {
    const h = harnessWithVariation();
    await h.connect();
    await h.engine.setMenuLink({ clientId: TENANT, provider: IFOOD, externalSku: "SKU-1", menuItemId: "menu-1" });

    await deliverIfood(h, ifoodPlaced("ext-1"));

    expect(h.created[0]?.lines).toEqual([expect.objectContaining({ subjectRef: "menu-1", variationRef: null })]);
    expect(await h.engine.menuLinks({ clientId: TENANT })).toEqual([
      expect.objectContaining({ menuItemId: "menu-1", variationId: null }),
    ]);
  });

  it("an unmapped line carries no variation", async () => {
    const h = harnessWithVariation();
    await h.connect();

    await deliverIfood(h, ifoodPlaced("ext-1"));

    expect(h.created[0]?.lines).toEqual([expect.objectContaining({ subjectRef: null, variationRef: null })]);
  });

  it("re-mapping to the item alone clears the variation, and an unmap clears both", async () => {
    const h = harnessWithVariation();
    const link = { clientId: TENANT, provider: IFOOD, externalSku: "SKU-1" };
    await h.engine.setMenuLink({ ...link, menuItemId: "menu-1", variationId: "var-1" });

    const parentOnly = await h.engine.setMenuLink({ ...link, menuItemId: "menu-1" });
    await h.engine.setMenuLink({ ...link, menuItemId: "menu-1", variationId: "var-1" });
    const unmapped = await h.engine.setMenuLink({ ...link, menuItemId: null });

    expect(parentOnly).toMatchObject({ menuItemId: "menu-1", variationId: null });
    expect(unmapped).toMatchObject({ menuItemId: null, variationId: null });
    expect(h.memory.tables.marketplaceMenuLink.rows[0]).toMatchObject({ menuItemId: null, variationId: null });
  });

  it("refuses, writing nothing, a variation that is not the item's, one on an unmap, and any when the host cannot answer", async () => {
    const h = harnessWithVariation();
    const refused = await h.engine.upsertMenuLinks({
      clientId: TENANT,
      rows: [
        { provider: IFOOD, externalSku: "SKU-1", menuItemId: "menu-1", variationId: "var-1" },
        { provider: IFOOD, externalSku: "SKU-2", menuItemId: "menu-2", variationId: "var-1" },
        { provider: IFOOD, externalSku: "SKU-3", menuItemId: null, variationId: "var-1" },
        { provider: IFOOD, externalSku: "SKU-4", menuItemId: "foreign", variationId: "var-1" },
      ],
    });
    const blind = harnessWithVariation({ variations: false });
    const noPort = await blind.engine.upsertMenuLinks({
      clientId: TENANT,
      rows: [{ provider: IFOOD, externalSku: "SKU-1", menuItemId: "menu-1", variationId: "var-1" }],
    });
    const parentWithoutPort = await blind.engine.setMenuLink({ clientId: TENANT, provider: IFOOD, externalSku: "SKU-1", menuItemId: "menu-1" });

    expect(refused).toEqual({
      kind: "refused",
      problems: [
        { path: ["links", 1, "variationId"], code: "CATALOG_ITEM_NOT_FOUND" },
        { path: ["links", 2, "variationId"], code: "CATALOG_ITEM_NOT_FOUND" },
        { path: ["links", 3, "menuItemId"], code: "CATALOG_ITEM_NOT_FOUND" },
      ],
    });
    expect(h.memory.tables.marketplaceMenuLink.rows).toEqual([]);
    expect(noPort).toEqual({ kind: "refused", problems: [{ path: ["links", 0, "variationId"], code: "CATALOG_ITEM_NOT_FOUND" }] });
    expect(parentWithoutPort).toMatchObject({ menuItemId: "menu-1", variationId: null });
  });
});

describe("the variation migration", () => {
  const MIGRATIONS = new URL("../../prisma/migrations/", import.meta.url);
  const sqls = () =>
    readdirSync(MIGRATIONS)
      .sort()
      .map((dir) => readFileSync(new URL(`${dir}/migration.sql`, MIGRATIONS), "utf8"));

  it("adds a nullable variation_id, keeps an existing link the item alone, and replays as a no-op", async () => {
    const pg = new PGlite();
    const all = sqls();
    for (const sql of all.slice(0, -1)) await pg.exec(sql);
    await pg.exec(
      `INSERT INTO marketplace_menu_links (id, client_id, provider, external_sku, menu_item_id, updated_at)
       VALUES ('l-1', 't', 'IFOOD', 'SKU-1', 'menu-1', now())`,
    );

    for (const sql of all) await pg.exec(sql);
    await pg.exec(`UPDATE marketplace_menu_links SET variation_id = 'var-1' WHERE id = 'l-1'`);
    const rows = await pg.query<{ menu_item_id: string; variation_id: string | null }>(
      "SELECT menu_item_id, variation_id FROM marketplace_menu_links",
    );

    expect(all.at(-1)?.startsWith("-- @domains: marketplace")).toBe(true);
    expect(rows.rows).toEqual([{ menu_item_id: "menu-1", variation_id: "var-1" }]);
  });
});
