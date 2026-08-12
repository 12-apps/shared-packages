/**
 * Everything `@12-apps/entity-lifecycle` needs from a HOST, in one object
 * (12-17).
 *
 * What is genuinely the host's, and all that is here: who is calling (a
 * header-driven session stand-in — a browser cannot have a real one), the
 * tenant's two feature layers (in a real host, two JSON columns on its tenant
 * row; here a fixture map), the caller's permission ids, the user directory,
 * the ENTITY TABLES with their ops (the two demo collections below), and
 * where the four owned tables live (the PGlite-backed seam in
 * `lifecycle-db.ts`). Everything else — the generated endpoints, feature
 * gates, approvals interception, parsing, statuses, the envelope — is the
 * package's, which is the entire claim under test.
 *
 * Two collections are registered on purpose: the recycle bin and the
 * approvals inbox are CROSS-collection surfaces, and a harness with one
 * entity type could never exercise their dispatch.
 */
import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import type { Context } from 'hono';
import type { EntityOps, FeatureFlagMap, Snapshot, WriteResult } from '@12-apps/entity-lifecycle';
import type { LifecycleActor } from '@12-apps/entity-lifecycle/server';
import { entityLifecycleRouter } from '@12-apps/entity-lifecycle/hono';

import { lifecycleDb } from './lifecycle-db';

/** The mounted surface's type — inferred, so hosts keep the whole handle. */
export type HarnessLifecycle = ReturnType<typeof lifecycleHost>;

/** The primary tenant — the one the SPA page and most specs drive. */
export const LIFECYCLE_TENANT_ID = 'harness';

/**
 * A second tenant entitled to NOTHING: versioning/drafts/approvals all
 * resolve `not-entitled` for it, so the feature-off 403 paths are exercised
 * at the tarball level rather than only in the package's unit suite.
 */
export const LIFECYCLE_TENANT_OFF_ID = 'harness-off';

/** The feature layers per tenant — host state, crossed by value on the actor. */
const TENANT_FLAGS: Record<string, { entitlements: FeatureFlagMap; settings: FeatureFlagMap }> = {
  [LIFECYCLE_TENANT_ID]: {
    entitlements: { versioning: true, drafts: true, approvals: true },
    // Approvals ON for the harness tenant (future-pay's default is off): the
    // parked-write flows are the surface's hardest part, so the fixture keeps
    // them reachable.
    settings: { versioning: true, drafts: true, approvals: true },
  },
  [LIFECYCLE_TENANT_OFF_ID]: { entitlements: {}, settings: {} },
};

/** The people. owner-1 approves; editor-1 writes and parks. */
export const LIFECYCLE_USERS: readonly {
  id: string;
  name: string;
  permissions: readonly string[];
}[] = [
  { id: 'owner-1', name: 'Ana Proprietária', permissions: ['products:approve', 'suppliers:approve'] },
  { id: 'editor-1', name: 'Eduardo Editor', permissions: [] },
];

const DIRECTORY = new Map(LIFECYCLE_USERS.map((user) => [user.id, user]));

/** The header a spec sets to act as someone else; the SPA's default is the owner. */
const ACTOR_HEADER = 'x-lifecycle-user';

/**
 * The two demo entity tables — HOST tables, created by the host (a real
 * adopter's schema already has its products/suppliers). `archived_at` is the
 * soft-delete flag the lifecycle ops stamp; `published_version` is the
 * mirror column `onVersionRecorded` maintains.
 */
export async function createLifecycleDemoTables(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS demo_products (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      archived_at TIMESTAMP(3),
      published_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS demo_suppliers (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      name TEXT NOT NULL,
      archived_at TIMESTAMP(3)
    );
  `);
}

/** Wipe + reseed the lifecycle tables — the `/__harness/reset` contract. */
export async function reseedLifecycle(pg: PGlite): Promise<void> {
  await pg.exec(
    'TRUNCATE TABLE entity_versions, recycle_bin_entries, entity_drafts, change_requests, demo_products, demo_suppliers',
  );
  await pg.query(
    `INSERT INTO demo_products (id, client_id, name, price_cents) VALUES
       ('prod-agua', $1, 'Água com gás', 450),
       ('prod-suco', $1, 'Suco de laranja', 1200)`,
    [LIFECYCLE_TENANT_ID],
  );
  await pg.query(
    `INSERT INTO demo_suppliers (id, client_id, name) VALUES
       ('sup-distribuidora', $1, 'Distribuidora Aurora')`,
    [LIFECYCLE_TENANT_ID],
  );
}

interface ProductSqlRow {
  id: string;
  name: string;
  price_cents: number;
  published_version: number;
}

/** The products collection's ops — plain SQL a real host writes with Prisma. */
function productOps(pg: PGlite): EntityOps {
  return {
    async readSnapshot(tenantId, entityId) {
      const { rows } = await pg.query<ProductSqlRow>(
        `SELECT id, name, price_cents, published_version FROM demo_products
         WHERE id = $1 AND client_id = $2 AND archived_at IS NULL`,
        [entityId, tenantId],
      );
      const row = rows[0];
      if (!row) return null;
      // The editable CONTENT only — the mirror column is not part of history.
      return { name: row.name, priceCents: row.price_cents };
    },
    async applySnapshot(tenantId, entityId, snapshot) {
      const name = typeof snapshot.name === 'string' ? snapshot.name : '';
      const priceCents = typeof snapshot.priceCents === 'number' ? snapshot.priceCents : 0;
      if (entityId === null) {
        const id = randomUUID();
        await pg.query(
          `INSERT INTO demo_products (id, client_id, name, price_cents) VALUES ($1, $2, $3, $4)`,
          [id, tenantId, name, priceCents],
        );
        return id;
      }
      await pg.query(
        `UPDATE demo_products SET name = $3, price_cents = $4 WHERE id = $1 AND client_id = $2`,
        [entityId, tenantId, name, priceCents],
      );
      return entityId;
    },
    async archive(tenantId, entityId) {
      const { affectedRows } = await pg.query(
        `UPDATE demo_products SET archived_at = NOW()
         WHERE id = $1 AND client_id = $2 AND archived_at IS NULL`,
        [entityId, tenantId],
      );
      return (affectedRows ?? 0) > 0;
    },
    async unarchive(tenantId, entityId) {
      const { affectedRows } = await pg.query(
        `UPDATE demo_products SET archived_at = NULL WHERE id = $1 AND client_id = $2`,
        [entityId, tenantId],
      );
      return (affectedRows ?? 0) > 0;
    },
    async hardDelete(tenantId, entityId) {
      await pg.query(`DELETE FROM demo_products WHERE id = $1 AND client_id = $2`, [
        entityId,
        tenantId,
      ]);
    },
    async onVersionRecorded(tenantId, entityId, version) {
      // Mirror onto the entity so lists can show "v12" without joining history.
      await pg.query(
        `UPDATE demo_products SET published_version = $3 WHERE id = $1 AND client_id = $2`,
        [entityId, tenantId, version],
      );
    },
  };
}

/** The suppliers collection's ops — the second type the bin dispatch needs. */
function supplierOps(pg: PGlite): EntityOps {
  return {
    async readSnapshot(tenantId, entityId) {
      const { rows } = await pg.query<{ name: string }>(
        `SELECT name FROM demo_suppliers
         WHERE id = $1 AND client_id = $2 AND archived_at IS NULL`,
        [entityId, tenantId],
      );
      const row = rows[0];
      return row ? { name: row.name } : null;
    },
    async applySnapshot(tenantId, entityId, snapshot) {
      const name = typeof snapshot.name === 'string' ? snapshot.name : '';
      if (entityId === null) {
        const id = randomUUID();
        await pg.query(`INSERT INTO demo_suppliers (id, client_id, name) VALUES ($1, $2, $3)`, [
          id,
          tenantId,
          name,
        ]);
        return id;
      }
      await pg.query(`UPDATE demo_suppliers SET name = $3 WHERE id = $1 AND client_id = $2`, [
        entityId,
        tenantId,
        name,
      ]);
      return entityId;
    },
    async archive(tenantId, entityId) {
      const { affectedRows } = await pg.query(
        `UPDATE demo_suppliers SET archived_at = NOW()
         WHERE id = $1 AND client_id = $2 AND archived_at IS NULL`,
        [entityId, tenantId],
      );
      return (affectedRows ?? 0) > 0;
    },
    async unarchive(tenantId, entityId) {
      const { affectedRows } = await pg.query(
        `UPDATE demo_suppliers SET archived_at = NULL WHERE id = $1 AND client_id = $2`,
        [entityId, tenantId],
      );
      return (affectedRows ?? 0) > 0;
    },
    async hardDelete(tenantId, entityId) {
      await pg.query(`DELETE FROM demo_suppliers WHERE id = $1 AND client_id = $2`, [
        entityId,
        tenantId,
      ]);
    },
  };
}

/** WHO + the tenant's layers, resolved the way a real host resolves them. */
export function resolveLifecycleActor(c: Context): LifecycleActor | null {
  const tenantId = c.req.param('tenantSlug');
  if (!tenantId || !(tenantId in TENANT_FLAGS)) return null;
  const flags = TENANT_FLAGS[tenantId] as (typeof TENANT_FLAGS)[string];
  const userId = c.req.header(ACTOR_HEADER) ?? 'owner-1';
  if (userId === 'anonymous') return null;
  const user = DIRECTORY.get(userId);
  if (!user) return null;
  return {
    tenantId,
    userId: user.id,
    entitlements: flags.entitlements,
    settings: flags.settings,
    permissions: new Set(user.permissions),
  };
}

/** The mounted surface: the package's router behind this host's actor seam. */
export function lifecycleHost(pg: PGlite) {
  return entityLifecycleRouter({
    db: async () => lifecycleDb(pg),
    entities: [
      {
        entityType: 'product',
        slug: 'catalog-items',
        features: { versioning: true, drafts: true, approvals: true },
        label: (snapshot: Snapshot) =>
          typeof snapshot.name === 'string' && snapshot.name.length > 0
            ? snapshot.name
            : 'Produto',
        retention: { maxVersions: 50, maxAgeDays: 365 },
        approvePermission: 'products:approve',
        ops: productOps(pg),
        publishedVersion: async (tenantId, entityId) => {
          const { rows } = await pg.query<{ published_version: number }>(
            `SELECT published_version FROM demo_products WHERE id = $1 AND client_id = $2`,
            [entityId, tenantId],
          );
          return rows[0]?.published_version ?? null;
        },
      },
      {
        entityType: 'supplier',
        slug: 'demo-suppliers',
        features: { versioning: true, drafts: true, approvals: true },
        label: (snapshot: Snapshot) =>
          typeof snapshot.name === 'string' && snapshot.name.length > 0
            ? snapshot.name
            : 'Fornecedor',
        approvePermission: 'suppliers:approve',
        ops: supplierOps(pg),
      },
    ],
    directory: {
      getUsers: async (ids) =>
        ids.flatMap((id) => {
          const user = DIRECTORY.get(id);
          return user ? [{ id: user.id, name: user.name }] : [];
        }),
    },
    resolveActor: resolveLifecycleActor,
  });
}

interface ListedProduct {
  id: string;
  name: string;
  priceCents: number;
  publishedVersion: number;
}

/**
 * The host's OWN demo-entity routes — the glue a real adopter already has
 * (its products CRUD), funnelled through the packaged lifecycle handle so a
 * delete lands in the bin and an update records a version / parks for
 * approval. Everything below `entity('product')` is host vocabulary.
 */
export function demoEntityRoutes(lifecycle: HarnessLifecycle, pg: PGlite) {
  const products = lifecycle.entity('product');
  const suppliers = lifecycle.entity('supplier');

  const outcome = (result: WriteResult) =>
    result.status === 'applied'
      ? { applied: true, entityId: result.entityId, requestId: null }
      : { applied: false, entityId: null, requestId: result.requestId };

  return {
    async list(c: Context) {
      const actor = resolveLifecycleActor(c);
      if (!actor) return c.json({ error: 'Não autenticado.' }, 401);
      const { rows } = await pg.query<{
        id: string;
        name: string;
        price_cents: number;
        published_version: number;
      }>(
        `SELECT id, name, price_cents, published_version FROM demo_products
         WHERE client_id = $1 AND archived_at IS NULL ORDER BY name`,
        [actor.tenantId],
      );
      const items: ListedProduct[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        priceCents: row.price_cents,
        publishedVersion: row.published_version,
      }));
      return c.json({ data: { items } });
    },
    async save(c: Context) {
      const actor = resolveLifecycleActor(c);
      if (!actor) return c.json({ error: 'Não autenticado.' }, 401);
      const body = (await c.req.json().catch(() => null)) as {
        name?: unknown;
        priceCents?: unknown;
      } | null;
      if (!body || typeof body.name !== 'string' || body.name.length === 0) {
        return c.json({ error: 'Dados inválidos.' }, 400);
      }
      const snapshot: Snapshot = {
        name: body.name,
        priceCents: typeof body.priceCents === 'number' ? body.priceCents : 0,
      };
      const id = c.req.param('id') ?? null;
      const ctx = products.context(actor);
      const result = id
        ? await products.lifecycle.update(ctx, id, snapshot)
        : await products.lifecycle.create(ctx, snapshot);
      return c.json({ data: outcome(result) }, result.status === 'applied' ? 200 : 202);
    },
    async remove(c: Context) {
      const actor = resolveLifecycleActor(c);
      if (!actor) return c.json({ error: 'Não autenticado.' }, 401);
      const id = c.req.param('id');
      const result = await products.lifecycle.softDelete(products.context(actor), id);
      return c.json({ data: outcome(result) }, result.status === 'applied' ? 200 : 202);
    },
    async removeSupplier(c: Context) {
      const actor = resolveLifecycleActor(c);
      if (!actor) return c.json({ error: 'Não autenticado.' }, 401);
      const id = c.req.param('id');
      const result = await suppliers.lifecycle.softDelete(suppliers.context(actor), id);
      return c.json({ data: outcome(result) }, result.status === 'applied' ? 200 : 202);
    },
  };
}
