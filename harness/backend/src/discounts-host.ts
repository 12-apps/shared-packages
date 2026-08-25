/**
 * The `@12-apps/discounts` adoption, through the wiring consumer like the
 * feature-flags and reports surfaces beside it.
 *
 * What is genuinely the HOST's, and all that is here: where the rows are (the
 * PGlite-backed seam in `discounts-db.ts`), which words a human reads (the
 * pt-BR pack, passed by hand), which of THIS host's tables a discount may
 * point at (the collections), the one filter the package cannot own, and who
 * is calling. Everything else — the write rules, the scope narrowing, the
 * either/or column folding, the envelope, the refusals — is the package's,
 * which is the entire claim under test.
 *
 * ## The collections are the interesting half
 *
 * `DiscountableCollection` is how a host says "a discount may target MY
 * categories and MY items", and registering them is what moves the
 * cross-tenant guard and the picker's reference data into the package. A
 * harness with no collections would adopt the surface and never exercise
 * `assertTargetsOwned` — so this host has a small catalog of its own, in its
 * own tables, exactly as an adopter does.
 *
 * The catalog is deliberately NOT a discounts concern and lives in host
 * tables: that separation is the property `ForeignTargetError` protects, and
 * a harness whose "categories" were rows of `discount_targets` could not tell
 * a foreign target from a typo.
 */
import type { PGlite } from '@electric-sql/pglite';
import { DISCOUNT_WINDOW_STATES } from '@12-apps/discounts';
import { discountsManifest } from '@12-apps/discounts/manifest';
import { discountsServerManifest } from '@12-apps/discounts/manifest/server';
import {
  createDiscountListQuery,
  type DiscountableCollection,
  type DiscountableOps,
  type DiscountsActor,
  type DiscountTarget,
} from '@12-apps/discounts/server';
import { PT_BR_DISCOUNTS_SERVER_COPY } from '@12-apps/discounts/server/pt-BR';
import { parseSearchConfig } from '@12-apps/shared-helpers/search';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';
import type { MountedRoute } from '@12-apps/wiring';
import { Hono } from 'hono';
import { z } from 'zod';

import { discountStore, DISCOUNTS_TENANT_ID } from './discounts-db';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/** Where `mount-surfaces.ts` hangs the router — the adoption's claim. */
export const DISCOUNTS_MOUNT_PATH = '/api/admin/:tenantSlug';

/**
 * The list query, extended with the pill the package cannot express.
 *
 * `window` compares two nullable date columns against "now", which no
 * `filterableField` describes — so the schema is built HERE, from the
 * package's own config plus this key, and the SAME object reaches route
 * validation and the store. The VALUES are the package's stable English
 * tokens; a host's own words belong on the pill, never on the wire.
 */
export const listDiscountsQuery = createDiscountListQuery(parseSearchConfig(), {
  window: z.enum(DISCOUNT_WINDOW_STATES).optional(),
});

/** The host catalog a discount may point at — two categories and three items. */
export const HARNESS_CATEGORIES = [
  { id: 'cat-bebidas', name: 'Bebidas' },
  { id: 'cat-lanches', name: 'Lanches' },
] as const;

export const HARNESS_ITEMS = [
  { id: 'item-cafe', name: 'Café', categoryId: 'cat-bebidas' },
  { id: 'item-suco', name: 'Suco', categoryId: 'cat-bebidas' },
  { id: 'item-x-salada', name: 'X-Salada', categoryId: 'cat-lanches' },
] as const;

/**
 * The host's own catalog tables, and the rows in them.
 *
 * A REAL table rather than a constant, because `DiscountableOps` is a query
 * seam: a host answers "does this tenant own these ids" from its database, and
 * a harness that answered from an array would prove the shape of the port
 * without proving anything about the question.
 */
export async function createDiscountCatalogTables(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS harness_categories (
      id        TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      name      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS harness_menu_items (
      id          TEXT PRIMARY KEY,
      client_id   TEXT NOT NULL,
      category_id TEXT NOT NULL,
      name        TEXT NOT NULL
    );
  `);
}

/** Back to the seeded catalog + no discounts, for the suite between cases. */
export async function reseedDiscounts(pg: PGlite): Promise<void> {
  await pg.exec(`
    DELETE FROM discount_targets;
    DELETE FROM discount_combo_slots;
    DELETE FROM discounts;
    DELETE FROM harness_menu_items;
    DELETE FROM harness_categories;
  `);
  for (const category of HARNESS_CATEGORIES) {
    await pg.query('INSERT INTO harness_categories (id, client_id, name) VALUES ($1, $2, $3)', [
      category.id,
      DISCOUNTS_TENANT_ID,
      category.name,
    ]);
  }
  for (const item of HARNESS_ITEMS) {
    await pg.query(
      'INSERT INTO harness_menu_items (id, client_id, category_id, name) VALUES ($1, $2, $3, $4)',
      [item.id, DISCOUNTS_TENANT_ID, item.categoryId, item.name],
    );
  }
}

/**
 * One collection's ops over a host table, `clientId`-first like the port asks.
 *
 * `ownsAll` is a COUNT rather than a fetch-and-compare, and it is the
 * cross-tenant guard: without it a crafted write could point one store's
 * promotion at another store's catalog, and the reverse menu-badge lookup
 * would then advertise it there. Counting distinct ids is what makes a
 * duplicate id in the request not stand in for a missing one.
 */
function opsOver(pg: PGlite, table: string, nested: boolean): DiscountableOps {
  const ops: DiscountableOps = {
    async list(clientId: string): Promise<readonly DiscountTarget[]> {
      const result = await pg.query<{ id: string; name: string; parent_id: string | null }>(
        `SELECT id, name, ${nested ? 'category_id' : 'NULL'} AS parent_id
           FROM ${table} WHERE client_id = $1 ORDER BY name ASC`,
        [clientId],
      );
      return result.rows.map((row) => ({ id: row.id, name: row.name, parentId: row.parent_id }));
    },
    async ownsAll(clientId: string, ids: readonly string[]): Promise<boolean> {
      if (ids.length === 0) return true;
      const placeholders = ids.map((_, index) => `$${index + 2}`).join(', ');
      const result = await pg.query<{ owned: string }>(
        `SELECT COUNT(DISTINCT id)::text AS owned FROM ${table}
           WHERE client_id = $1 AND id IN (${placeholders})`,
        [clientId, ...ids],
      );
      return Number(result.rows[0]?.owned ?? 0) === new Set(ids).size;
    },
  };
  if (!nested) return ops;
  return {
    ...ops,
    async parents(clientId: string): Promise<ReadonlyMap<string, string | null>> {
      const result = await pg.query<{ id: string; category_id: string | null }>(
        `SELECT id, category_id FROM ${table} WHERE client_id = $1`,
        [clientId],
      );
      return new Map(result.rows.map((row) => [row.id, row.category_id]));
    },
  };
}

/**
 * The two dimensions this host declares discountable.
 *
 * `label` is host vocabulary in the host's language — the package refuses to
 * ship one, for the same reason it refuses to ship a flag catalog. `slug` is
 * the picker's URL segment and its `data-testid` stem.
 *
 * Neither collection NESTS here. Items carry a `category_id`, but nesting
 * means "a target on this row covers the rows filed under it", which is a
 * claim about CATEGORIES covering items — a shape this host does not model,
 * since its categories have no parents of their own.
 */
function collectionsFor(pg: PGlite): readonly DiscountableCollection[] {
  return [
    {
      targetType: 'CATEGORY',
      slug: 'categories',
      label: 'Categorias',
      ops: opsOver(pg, 'harness_categories', false),
    },
    {
      targetType: 'ITEM',
      slug: 'items',
      label: 'Produtos',
      ops: opsOver(pg, 'harness_menu_items', true),
    },
  ];
}

export interface HarnessDiscounts {
  router: Hono;
  report: WiringReport;
  routes: readonly MountedRoute[];
}

export function discountsHost(pg: PGlite): HarnessDiscounts {
  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    // The mandatory observability capability: the binder scopes a logger to
    // the manifest's own namespace, so a discounts failure files under
    // `discounts` rather than nowhere.
    ports: { loggerFor: harnessLoggerFor },
  });
  host.adoptServer({
    manifest: discountsManifest,
    // The packaged journeys drive SCREENS — the promotions grid, the compose
    // dialog, the row menu — so the world they ask for is a browser's, and this
    // process has no browser. `harness/frontend` binds it, as it does for auth,
    // impersonation, reports and rbac.
    e2e: { declined: 'the journeys drive screens — the web harness answers for the world' },
    server: discountsServerManifest,
    bindings: {
      http: {
        mountPath: DISCOUNTS_MOUNT_PATH,
        config: {
          store: discountStore(pg),
          // Passed BY HAND — this harness is a pt-BR host, and choosing that
          // is a reviewable line, never a silent default.
          copy: PT_BR_DISCOUNTS_SERVER_COPY,
          logger: harnessLoggerFor(discountsManifest.observability.namespace),
          collections: collectionsFor(pg),
          listQuery: listDiscountsQuery,
        },
      },
    },
  });
  const wired = host.assemble();
  return {
    // The tenant comes from the PATH here, the way it does in a real host —
    // `:tenantSlug` is the segment, and the guard that turns it into a tenant
    // id is what a real adopter replaces this line with.
    router: honoRouterFor(wired.routes, (c): DiscountsActor => ({
      clientId: c.req.param('tenantSlug') ?? DISCOUNTS_TENANT_ID,
    })),
    report: wired.report,
    routes: wired.routes,
  };
}
