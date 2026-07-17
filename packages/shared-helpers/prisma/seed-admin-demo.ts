/**
 * Ephemeral demo seed for manually testing the admin overhaul (FUT-77 epic):
 * suppliers (fornecedores), configurable loss reasons, component products with
 * stock, and a recipe for a producible product. Layers on top of the base seed
 * (`prisma/seed.ts`) — run AFTER provisioning the dev DB. Idempotent (upserts).
 *
 *   PGLITE_DATA_DIR=<abs .dev-db> USE_FILE_DB=1 SKIP_ENV_VALIDATION=1 \
 *     pnpm --filter @12-apps/shared-helpers exec tsx prisma/seed-admin-demo.ts
 */
import type { PrismaClient } from "@prisma/client";

import { getPrismaClient } from "../src/prisma/index";

const SLUG = "default-client";

/**
 * Dev admin seeded as an OWNER of the baseline tenant so local manual testing
 * has a ready-to-use admin without going through the Google sign-up + terms
 * flow. Email is overridable via `DEV_ADMIN_EMAIL`.
 */
const DEV_ADMIN = {
  email: process.env.DEV_ADMIN_EMAIL ?? "thomfilg.bingo@gmail.com",
  name: "Dev Admin",
};

// Mirror of `apps/web/lib/terms.ts` TERMS_VERSION. shared-helpers cannot import
// from the web app (wrong dependency direction), so it is duplicated here and
// must be kept in sync — the seeded admin is only "signed up" (skips the
// /signup consent gate) when this equals the app's current version.
const TERMS_VERSION = "2026-06-29";

/**
 * Upsert the dev admin User (terms pre-accepted) + an OWNER Membership on the
 * baseline tenant, so `/admin/<slug>/…` is reachable in local dev immediately.
 */
async function upsertDevAdmin(prisma: PrismaClient, clientId: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: DEV_ADMIN.email },
    create: {
      email: DEV_ADMIN.email,
      name: DEV_ADMIN.name,
      provider: "google",
      termsAcceptedAt: new Date(),
      termsVersion: TERMS_VERSION,
    },
    update: { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION },
  });
  await prisma.membership.upsert({
    where: { userId_clientId: { userId: user.id, clientId } },
    create: { userId: user.id, clientId, role: "OWNER" },
    update: { role: "OWNER" },
  });
  return user.email;
}

const SUPPLIERS = [
  { name: "Distribuidora Central", contactName: "Marcos Lima", email: "vendas@central.com", phone: "81 3333-1000", city: "Recife", state: "PE", status: "ACTIVE" },
  { name: "Bebidas do Vale", contactName: "Ana Souza", email: "ana@dovale.com", phone: "81 99999-2000", city: "Caruaru", state: "PE", status: "ACTIVE" },
  { name: "Padaria Ideal Atacado", contactName: "João Pereira", phone: "81 98888-3000", city: "Olinda", state: "PE", status: "ACTIVE" },
  { name: "Fornecedor Antigo (inativo)", contactName: "—", city: "Jaboatão", state: "PE", status: "INACTIVE" },
];

const LOSS_REASONS = [
  { name: "Queimou", category: "SPOILAGE" },
  { name: "Vencido", category: "SPOILAGE" },
  { name: "Quebra / dano", category: "LOSS" },
  { name: "Derrubou", category: "WASTE" },
  { name: "Furto", category: "LOSS" },
];

/** Component products (with opening stock) consumed by the demo recipe. */
const COMPONENTS = [
  { name: "Pão de Hambúrguer (un)", quantity: 200, unitCostCents: 80 },
  { name: "Carne 150g (un)", quantity: 150, unitCostCents: 350 },
  { name: "Queijo Cheddar (fatia)", quantity: 300, unitCostCents: 60 },
];

const OUTPUT = { name: "Hambúrguer Artesanal (produção)", priceCents: 2500 };

async function upsertProductWithStock(
  prisma: PrismaClient,
  clientId: string,
  input: { name: string; priceCents?: number; quantity?: number; unitCostCents?: number; listed?: boolean },
): Promise<string> {
  const product = await prisma.product.upsert({
    where: { clientId_name: { clientId, name: input.name } },
    create: {
      clientId,
      name: input.name,
      description: "Demo — epic de estoque",
      priceCents: input.priceCents ?? 0,
      listed: input.listed ?? true,
    },
    update: {},
  });
  const quantity = input.quantity ?? 0;
  await prisma.inventory.upsert({
    where: { productId: product.id },
    create: { productId: product.id, quantity },
    update: { quantity },
  });
  if (quantity > 0) {
    const unitCostCents = input.unitCostCents ?? 0;
    await prisma.stockLot.upsert({
      where: { id: `${product.id}-opening` },
      create: {
        id: `${product.id}-opening`,
        clientId,
        productId: product.id,
        source: unitCostCents > 0 ? "PURCHASE" : "ADJUSTMENT",
        quantityReceived: quantity,
        quantityRemaining: quantity,
        unitCostCents,
        totalCostCents: unitCostCents * quantity,
        purchaseDate: new Date(),
      },
      update: {
        quantityReceived: quantity,
        quantityRemaining: quantity,
        unitCostCents,
        totalCostCents: unitCostCents * quantity,
      },
    });
  }
  return product.id;
}

async function main(): Promise<void> {
  const prisma = await getPrismaClient();
  try {
    const client = await prisma.client.findUnique({ where: { slug: SLUG } });
    if (!client) throw new Error(`Baseline client "${SLUG}" not found — run the base seed first.`);
    const clientId = client.id;

    const adminEmail = await upsertDevAdmin(prisma, clientId);

    for (const supplier of SUPPLIERS) {
      await prisma.supplier.upsert({
        where: { clientId_name: { clientId, name: supplier.name } },
        create: { clientId, ...supplier },
        update: { ...supplier },
      });
    }

    for (const [position, reason] of LOSS_REASONS.entries()) {
      await prisma.lossReason.upsert({
        where: { clientId_name: { clientId, name: reason.name } },
        create: { clientId, name: reason.name, category: reason.category, position },
        update: { category: reason.category, position },
      });
    }

    const componentIds: string[] = [];
    for (const component of COMPONENTS) {
      componentIds.push(await upsertProductWithStock(prisma, clientId, { ...component, listed: false }));
    }

    // Producible output starts with no stock; produção will consume the recipe.
    const outputId = await upsertProductWithStock(prisma, clientId, { ...OUTPUT, quantity: 0 });

    const recipe = await prisma.recipe.upsert({
      where: { productId: outputId },
      create: { clientId, productId: outputId },
      update: {},
    });
    await prisma.recipeComponent.deleteMany({ where: { recipeId: recipe.id } });
    await prisma.recipeComponent.createMany({
      data: [
        { recipeId: recipe.id, componentProductId: componentIds[0]!, quantity: 1, unit: "un" },
        { recipeId: recipe.id, componentProductId: componentIds[1]!, quantity: 1, unit: "un" },
        { recipeId: recipe.id, componentProductId: componentIds[2]!, quantity: 2, unit: "fatia" },
      ],
    });

    // eslint-disable-next-line no-console -- dev-only seed script summary
    console.log(
      `[demo] seeded admin ${adminEmail} (OWNER), ${SUPPLIERS.length} suppliers, ` +
        `${LOSS_REASONS.length} loss reasons, ${COMPONENTS.length} components + 1 recipe ` +
        `("${OUTPUT.name}") for ${SLUG}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
