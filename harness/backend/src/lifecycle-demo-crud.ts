/**
 * The demo host's OWN entity CRUD (12-17) — the glue a real adopter already
 * has, kept apart from `lifecycle-host.ts` on purpose: that file is the SEAMS
 * `@12-apps/entity-lifecycle` asks for (actor, feature layers, directory, ops,
 * db, the registrations), this one is the host's ordinary products/suppliers
 * routes. Nothing here is packaged behaviour; everything below
 * `entity('product')` is host vocabulary.
 *
 * What the routes do prove is the funnel: a host create/update/delete goes
 * through the packaged handle, so a delete lands in the bin and an update
 * records a version — or parks for approval (200 applied / 202 parked).
 *
 * `getOne` earns its place twice over. `GET /catalog-items/:id` is the CRUD
 * shape every adopter has AND the only shape that can capture a packaged
 * endpoint — two segments, exactly like the literal `GET /catalog-items/drafts`
 * — so its presence is what makes ADOPTING rule 7 falsifiable instead of
 * advisory (see the mount-order note in `app.ts` and the "mount order" cases in
 * `tests/lifecycle-endpoints.test.ts`).
 */
import type { PGlite } from '@electric-sql/pglite';
import type { Context } from 'hono';
import type { Snapshot, WriteResult } from '@12-apps/entity-lifecycle';

import {
  resolveLifecycleActor,
  type HarnessLifecycle,
  type ProductSqlRow,
} from './lifecycle-host';

interface ListedProduct {
  id: string;
  name: string;
  priceCents: number;
  publishedVersion: number;
}

/**
 * The host's product read, for its own list and read-one — soft-delete
 * filtered, like every read the host owns (ADOPTING rule 3).
 */
async function readDemoProducts(
  pg: PGlite,
  tenantId: string,
  id?: string,
): Promise<ListedProduct[]> {
  const { rows } = await pg.query<ProductSqlRow>(
    `SELECT id, name, price_cents, published_version FROM demo_products
     WHERE client_id = $1 AND archived_at IS NULL
       ${id === undefined ? '' : 'AND id = $2'} ORDER BY name`,
    id === undefined ? [tenantId] : [tenantId, id],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    publishedVersion: row.published_version,
  }));
}

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
      const items = await readDemoProducts(pg, actor.tenantId);
      return c.json({ data: { items } });
    },
    async getOne(c: Context) {
      const actor = resolveLifecycleActor(c);
      if (!actor) return c.json({ error: 'Não autenticado.' }, 401);
      const [item] = await readDemoProducts(pg, actor.tenantId, c.req.param('id'));
      if (!item) return c.json({ error: 'Item não encontrado.' }, 404);
      return c.json({ data: { item } });
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
