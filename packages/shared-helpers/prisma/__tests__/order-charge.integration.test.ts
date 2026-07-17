import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getPrismaClient,
  resetPrismaClient,
  type PrismaClient,
} from "../../src/prisma";

/**
 * Integration (FUT-190): the new `order_charges` table against a REAL Postgres
 * engine (PGlite/WASM) over the production schema + every committed migration —
 * no mocks. Proves the parts only the DB can enforce: two distinct
 * `provider_order_id` inserts succeed, the UNIQUE index rejects a duplicate
 * `provider_order_id`, deleting the parent order cascade-deletes its charges,
 * and `prisma.orderCharge` is queryable through the generated client.
 *
 * Provisioning mirrors the e2e / order-dedup path: open a file-backed PGlite,
 * replay every committed migration, close it, then point the shared-helpers
 * Prisma singleton (PGlite mode) at the same directory.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "../migrations");

async function applyMigrations(db: {
  exec: (sql: string) => Promise<unknown>;
}): Promise<void> {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    await db.exec(sql);
  }
}

const CLIENT_ID = "client-oc";
const USER_ID = "user-oc";

let dataDir: string;
let prisma: PrismaClient;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "order-charge-int-"));
  const { PGlite } = await import("@electric-sql/pglite");
  const provision = new PGlite(dataDir);
  await provision.waitReady;
  await applyMigrations(provision);
  await provision.close();

  process.env.USE_FILE_DB = "1";
  process.env.PGLITE_DATA_DIR = dataDir;
  process.env.SKIP_ENV_VALIDATION = "1";
  resetPrismaClient();
  prisma = await getPrismaClient();
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
  resetPrismaClient();
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.USE_FILE_DB;
  delete process.env.PGLITE_DATA_DIR;
  delete process.env.SKIP_ENV_VALIDATION;
}, 30_000);

/** Seed a store + buyer + one AWAITING_PAYMENT order, returning the order id. */
async function seedOrder(orderId: string): Promise<string> {
  await prisma.order.create({
    data: {
      id: orderId,
      clientId: CLIENT_ID,
      userId: USER_ID,
      method: "PIX",
      totalCents: 1000,
    },
  });
  return orderId;
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE order_charges, order_items, payments, orders, users, clients RESTART IDENTITY CASCADE;`,
  );
  await prisma.client.create({ data: { id: CLIENT_ID, slug: "tenant-oc", name: "Tenant OC" } });
  await prisma.user.create({ data: { id: USER_ID, email: "oc@example.com" } });
});

describe("order_charges table (integration)", () => {
  it("exposes a queryable prisma.orderCharge model", async () => {
    await seedOrder("order-1");
    const charges = await prisma.orderCharge.findMany({ where: { orderId: "order-1" } });
    expect(charges).toEqual([]);
  });

  it("stores two distinct provider_order_id charges for one order", async () => {
    await seedOrder("order-1");
    await prisma.orderCharge.create({
      data: { orderId: "order-1", providerOrderId: "ORDE_1", pixExpiresAt: new Date("2026-07-15T12:00:00Z") },
    });
    await prisma.orderCharge.create({
      data: { orderId: "order-1", providerOrderId: "ORDE_2", pixExpiresAt: new Date("2026-07-15T12:30:00Z") },
    });

    const charges = await prisma.orderCharge.findMany({ where: { orderId: "order-1" } });
    expect(charges).toHaveLength(2);
    expect(charges.map((c) => c.providerOrderId).sort()).toEqual(["ORDE_1", "ORDE_2"]);
  });

  it("rejects a duplicate provider_order_id via the unique index", async () => {
    await seedOrder("order-1");
    await prisma.orderCharge.create({ data: { orderId: "order-1", providerOrderId: "ORDE_DUP" } });

    await expect(
      prisma.orderCharge.create({ data: { orderId: "order-1", providerOrderId: "ORDE_DUP" } }),
    ).rejects.toThrow();
  });

  it("cascade-deletes an order's charges when the order is deleted", async () => {
    await seedOrder("order-1");
    await prisma.orderCharge.create({ data: { orderId: "order-1", providerOrderId: "ORDE_C" } });
    expect(await prisma.orderCharge.count({ where: { orderId: "order-1" } })).toBe(1);

    await prisma.order.delete({ where: { id: "order-1" } });

    expect(await prisma.orderCharge.count({ where: { orderId: "order-1" } })).toBe(0);
  });
});
