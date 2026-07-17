/**
 * Database seed.
 *
 * Seeds the baseline tenant (one `Client`, one `Unit`) plus the storefront
 * catalog: a nested `ProductCategory` tree (top-level categories → ordered
 * subcategories), the `Product`s under them, and an `Inventory` row per product.
 *
 * The catalog is data-driven: it is loaded from a JSON dataset under `seeds/`,
 * selected by the `SEED_DATASET` env var (default `regular`). Two ship:
 *   - `seeds/regular.json` — full catalog, the default for local development.
 *   - `seeds/minimum.json` — a tiny catalog for fast tests / quick checks.
 * Adding data is just editing (or adding) a JSON file — no code change.
 *
 * Every write is an idempotent `upsert` keyed on a unique field — the tenant by
 * `slug`, categories and products by the `(clientId, name)` composite, inventory
 * by `productId` — so the whole seed can re-run without creating duplicates or
 * hitting a unique-constraint error.
 *
 * Invoked deterministically via `pnpm --filter @repo/shared-helpers db:seed`
 * (Prisma `prisma.seed` config: `tsx prisma/seed.ts`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../src/prisma/index';

const BASELINE_CLIENT_NAME = 'Default Client';
// URL-safe handle for the baseline tenant. Matches the slug that migration
// `add_tenant_slug_status_profile` backfills from the name ("Default Client" ->
// "default-client"), so seeding an already-migrated DB upserts the same row.
const BASELINE_CLIENT_SLUG = 'default-client';
const BASELINE_UNIT_NAME = 'Each';

/** Dataset used when `SEED_DATASET` is unset — the fuller dev catalog. */
const DEFAULT_DATASET = 'regular';
const SEEDS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'seeds');

/** A sample sellable item, priced in integer cents (BRL), with its stock level. */
interface SeedProduct {
  name: string;
  description: string;
  priceCents: number;
  /** Initial stock. `0` items stay hidden from the public menu (out of stock). */
  quantity: number;
  /**
   * Optional acquisition cost per unit (integer cents) for the opening stock lot.
   * When set, the opening lot is a `PURCHASE` at this cost so profit/margin has a
   * realistic basis; when omitted the opening lot is a zero-cost `ADJUSTMENT`
   * ("cost unknown"). Either way the lot keeps `quantity == SUM(lot.remaining)`.
   */
  unitCostCents?: number;
}

interface SeedSubcategory {
  name: string;
  products: SeedProduct[];
}

interface SeedCategory {
  name: string;
  /** Products attached directly to the category (no subcategory). */
  products?: SeedProduct[];
  subcategories?: SeedSubcategory[];
}

/** On-disk dataset shape: `{ categories: SeedCategory[] }` (plus a `$comment`). */
interface SeedDataset {
  categories: SeedCategory[];
}

/**
 * Load the storefront catalog from `seeds/<dataset>.json`.
 *
 * `dataset` defaults to `SEED_DATASET` (then `regular`). Array order in the file
 * defines the display order persisted to each category's `position` (top-level
 * and within each parent).
 */
export function loadCatalog(dataset?: string): readonly SeedCategory[] {
  const name = dataset ?? process.env.SEED_DATASET ?? DEFAULT_DATASET;
  const file = join(SEEDS_DIR, `${name}.json`);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as SeedDataset;
  if (!Array.isArray(parsed.categories)) {
    throw new Error(`Seed dataset "${name}" is missing a "categories" array (${file})`);
  }
  return parsed.categories;
}

/** Upsert a product, its inventory aggregate, and an opening stock lot. */
async function seedProduct(
  prisma: PrismaClient,
  clientId: string,
  categoryId: string,
  product: SeedProduct,
): Promise<void> {
  const row = await prisma.product.upsert({
    where: { clientId_name: { clientId, name: product.name } },
    create: {
      name: product.name,
      description: product.description,
      priceCents: product.priceCents,
      clientId,
      categoryId,
    },
    update: { description: product.description, priceCents: product.priceCents, categoryId },
  });

  await prisma.inventory.upsert({
    where: { productId: row.id },
    create: { productId: row.id, quantity: product.quantity },
    update: { quantity: product.quantity },
  });

  // Keep the cost-ledger invariant `inventory.quantity == SUM(lot.remaining)`:
  // back the opening stock with a single lot. Idempotent via a deterministic id
  // derived from the (stable) product id, so re-seeding re-syncs rather than
  // piling up duplicate lots.
  if (product.quantity > 0) {
    const unitCostCents = product.unitCostCents ?? 0;
    await prisma.stockLot.upsert({
      where: { id: `${row.id}-opening` },
      create: {
        id: `${row.id}-opening`,
        clientId,
        productId: row.id,
        source: unitCostCents > 0 ? "PURCHASE" : "ADJUSTMENT",
        quantityReceived: product.quantity,
        quantityRemaining: product.quantity,
        unitCostCents,
        totalCostCents: unitCostCents * product.quantity,
        purchaseDate: new Date(),
      },
      update: {
        source: unitCostCents > 0 ? "PURCHASE" : "ADJUSTMENT",
        quantityReceived: product.quantity,
        quantityRemaining: product.quantity,
        unitCostCents,
        totalCostCents: unitCostCents * product.quantity,
      },
    });
  }
}

/** Parse the `ADMIN_EMAILS` allowlist (comma-separated) into normalized emails. */
function parseAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Stamp every existing `ADMIN_EMAILS` account as OWNER of the baseline tenant so
 * local/dev has a real tenant owner to work with. Idempotent and no-op when no
 * such user exists yet (the seed never creates users). Superadmins can already
 * administer any tenant via the env allowlist regardless of this row; the OWNER
 * membership just makes them appear in the tenant roster for local testing.
 */
async function seedOwnerMemberships(prisma: PrismaClient, clientId: string): Promise<void> {
  const emails = parseAdminEmails();
  if (emails.length === 0) return;

  const admins = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });

  for (const admin of admins) {
    await prisma.membership.upsert({
      where: { userId_clientId: { userId: admin.id, clientId } },
      create: { userId: admin.id, clientId, role: 'OWNER' },
      update: { role: 'OWNER' },
    });
  }
}

/**
 * Baseline stock-movement reasons (FUT-180): a starter set of loss and gain
 * reasons so the Configuração › Estoque page and the inventory Ajuste picker
 * have data out of the box. `kind` splits them; `category` sub-classifies losses
 * (unused for gains). Idempotent via the (clientId, name) unique key.
 */
const STOCK_REASONS: readonly { name: string; kind: 'LOSS' | 'GAIN'; category: string }[] = [
  { name: 'Vencido', kind: 'LOSS', category: 'SPOILAGE' },
  { name: 'Quebra / dano', kind: 'LOSS', category: 'LOSS' },
  { name: 'Furto', kind: 'LOSS', category: 'LOSS' },
  { name: 'Devolução de cliente', kind: 'GAIN', category: 'LOSS' },
  { name: 'Acerto de contagem', kind: 'GAIN', category: 'LOSS' },
];

/** Seed the starter loss + gain reasons for the baseline tenant (idempotent). */
async function seedStockReasons(prisma: PrismaClient, clientId: string): Promise<void> {
  for (const [position, reason] of STOCK_REASONS.entries()) {
    await prisma.lossReason.upsert({
      where: { clientId_name: { clientId, name: reason.name } },
      create: { clientId, name: reason.name, kind: reason.kind, category: reason.category, position },
      update: { kind: reason.kind, category: reason.category, position },
    });
  }
}

/** Seed one subcategory under `topId` plus the products directly under it. */
async function seedSubcategory(
  prisma: PrismaClient,
  clientId: string,
  topId: string,
  subIndex: number,
  sub: SeedSubcategory,
): Promise<void> {
  const subcategory = await prisma.productCategory.upsert({
    where: { clientId_name: { clientId, name: sub.name } },
    create: { name: sub.name, clientId, parentId: topId, position: subIndex },
    update: { parentId: topId, position: subIndex },
  });
  for (const product of sub.products) {
    await seedProduct(prisma, clientId, subcategory.id, product);
  }
}

/** Seed one top-level category: its direct products, then its subcategories. */
async function seedCategory(
  prisma: PrismaClient,
  clientId: string,
  categoryIndex: number,
  category: SeedCategory,
): Promise<void> {
  const top = await prisma.productCategory.upsert({
    where: { clientId_name: { clientId, name: category.name } },
    create: { name: category.name, clientId, position: categoryIndex },
    update: { position: categoryIndex, parentId: null },
  });
  for (const product of category.products ?? []) {
    await seedProduct(prisma, clientId, top.id, product);
  }
  for (const [subIndex, sub] of (category.subcategories ?? []).entries()) {
    await seedSubcategory(prisma, clientId, top.id, subIndex, sub);
  }
}

/**
 * Idempotently seed the baseline Client, Unit, the category tree, products and
 * inventory. Accepts the Prisma client so the helper is unit-testable, and an
 * optional explicit catalog (defaults to the `SEED_DATASET` JSON dataset).
 */
export const seed = async (
  prisma: PrismaClient,
  catalog: readonly SeedCategory[] = loadCatalog(),
): Promise<void> => {
  const client = await prisma.client.upsert({
    where: { slug: BASELINE_CLIENT_SLUG },
    create: { slug: BASELINE_CLIENT_SLUG, name: BASELINE_CLIENT_NAME },
    update: {},
  });

  await prisma.unit.upsert({
    where: { name: BASELINE_UNIT_NAME },
    create: { name: BASELINE_UNIT_NAME },
    update: {},
  });

  for (const [categoryIndex, category] of catalog.entries()) {
    await seedCategory(prisma, client.id, categoryIndex, category);
  }

  await seedStockReasons(prisma, client.id);
  await seedOwnerMemberships(prisma, client.id);
};

/**
 * Script entry point: resolves the singleton client, seeds, then disconnects.
 */
const main = async (): Promise<void> => {
  const prisma = await getPrismaClient();
  try {
    await seed(prisma);
  } finally {
    await prisma.$disconnect();
  }
};

// Run when executed directly (e.g. `tsx prisma/seed.ts`), not when imported.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
