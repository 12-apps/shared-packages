import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaClient } from '@prisma/client';

import { seed } from '../../prisma/seed';

// Mock @prisma/client so `new PrismaClient()` yields a controllable stub whose
// delegate `upsert`s echo back a record keyed on the requested unique field.
// The seed now keys the tenant on `slug` and the catalog on the
// `(clientId, name)` composite, so the echoed id derives from whichever key is
// present. This lets the seed helper run against a typed PrismaClient with no
// live database and no unsafe casts.
vi.mock('@prisma/client', () => {
  // Derive a stable id from whatever unique key the caller passed: `name`
  // (unit), `productId` (inventory), `slug` (client), or the composite
  // `clientId_name.name` (product/category).
  const keyOf = (where: {
    id?: string;
    name?: string;
    productId?: string;
    slug?: string;
    clientId_name?: { name?: string };
  }): string =>
    where.id ??
    where.name ??
    where.productId ??
    where.slug ??
    where.clientId_name?.name ??
    'x';

  const makeUpsert = () =>
    vi.fn(
      async ({
        where,
        create,
      }: {
        where: Parameters<typeof keyOf>[0];
        create: Record<string, unknown>;
      }) => ({ id: `id-${keyOf(where)}`, ...create }),
    );

  class PrismaClient {
    client = { upsert: makeUpsert() };
    unit = { upsert: makeUpsert() };
    productCategory = { upsert: makeUpsert() };
    product = { upsert: makeUpsert() };
    inventory = { upsert: makeUpsert() };
    // Opening stock lot per stocked product (keeps quantity == SUM(lot.remaining)).
    stockLot = { upsert: makeUpsert() };
    // Starter loss + gain reasons (FUT-180), upserted by (clientId, name).
    lossReason = { upsert: makeUpsert() };
    // OWNER-membership stamping: no admins to find unless ADMIN_EMAILS is set,
    // so findMany returns none and no membership upsert is issued.
    user = { findMany: vi.fn(async () => [] as { id: string }[]) };
    membership = { upsert: makeUpsert() };
    $disconnect = vi.fn();
  }

  return { PrismaClient };
});

describe('prisma seed helper', () => {
  let prisma: PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = new PrismaClient();
  });

  it('upserts the baseline Client (by slug) and Unit exactly once', async () => {
    await seed(prisma);

    expect(prisma.client.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.unit.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.client.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'default-client' },
        create: { slug: 'default-client', name: 'Default Client' },
        update: {},
      }),
    );
    expect(prisma.unit.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'Each' }, create: { name: 'Each' }, update: {} }),
    );
  });

  it('seeds ordered top-level categories and nested subcategories, keyed per tenant', async () => {
    await seed(prisma);

    // A top-level category: keyed on the (clientId, name) composite, scoped to
    // the client (echoed id `id-default-client`), ordered via `position`.
    expect(prisma.productCategory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId_name: { clientId: 'id-default-client', name: 'Bebidas' } },
        create: expect.objectContaining({
          name: 'Bebidas',
          clientId: 'id-default-client',
          position: 0,
        }),
      }),
    );
    // A subcategory: scoped to its parent (the mocked upsert echoes `id-<name>`).
    expect(prisma.productCategory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId_name: { clientId: 'id-default-client', name: 'Refrigerante' } },
        create: expect.objectContaining({
          name: 'Refrigerante',
          parentId: 'id-Bebidas',
          clientId: 'id-default-client',
        }),
      }),
    );
  });

  it('creates each product with integer-cents price and a matching inventory row', async () => {
    await seed(prisma);

    expect(prisma.product.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId_name: { clientId: 'id-default-client', name: 'Coca-Cola Lata 350ml' } },
        create: expect.objectContaining({
          name: 'Coca-Cola Lata 350ml',
          priceCents: 600,
          clientId: 'id-default-client',
          categoryId: 'id-Refrigerante',
        }),
      }),
    );

    // Stock is written to the product's inventory row (so it can show on the menu).
    expect(prisma.inventory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'id-Coca-Cola Lata 350ml' },
        create: expect.objectContaining({ productId: 'id-Coca-Cola Lata 350ml', quantity: 24 }),
      }),
    );

    // Every product gets exactly one inventory upsert.
    const products = vi.mocked(prisma.product.upsert).mock.calls.length;
    const inventories = vi.mocked(prisma.inventory.upsert).mock.calls.length;
    expect(products).toBeGreaterThan(0);
    expect(inventories).toBe(products);
  });

  it('is idempotent on re-run: upsert only (never create), no duplicates or errors', async () => {
    await expect(seed(prisma)).resolves.toBeUndefined();
    await expect(seed(prisma)).resolves.toBeUndefined();

    // Two runs => two baseline upserts each, still one logical row via the slug key.
    expect(prisma.client.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.unit.upsert).toHaveBeenCalledTimes(2);

    // No `create` delegate is exposed/used — idempotency is via upsert only.
    expect(prisma.client).not.toHaveProperty('create');
  });
});
