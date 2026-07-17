import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const schemaPath = join(__dirname, '../../prisma/schema.prisma');
const schema = readFileSync(schemaPath, 'utf-8');

describe('prisma schema — baseline domain models', () => {
  // FUT-2 (Login & Admin access) intentionally defines a real auth/accounts
  // `User` model — superseding the template's starter placeholder. It coexists
  // with the domain models below, so we validate its expected shape rather than
  // asserting its absence.
  it('defines the auth User (accounts) model with LGPD consent fields', () => {
    const body = schema.match(/model\s+User\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(body).not.toBe('');
    expect(body).toMatch(/email\s+String\s+@unique/);
    expect(body).toMatch(/provider\s+String\?/);
    expect(body).toMatch(/termsAcceptedAt\s+DateTime\?\s+@map\("terms_accepted_at"\)/);
    expect(body).toMatch(/termsVersion\s+String\?\s+@map\("terms_version"\)/);
    expect(body).toMatch(/@@map\("users"\)/);
  });

  it('preserves the generator client block', () => {
    expect(schema).toMatch(/generator\s+client\s*\{/);
    expect(schema).toMatch(/provider\s*=\s*"prisma-client-js"/);
  });

  it('preserves the datasource db block (provider only — url moves to prisma.config.ts in v7)', () => {
    expect(schema).toMatch(/datasource\s+db\s*\{/);
    expect(schema).toMatch(/provider\s*=\s*"postgresql"/);
    // Prisma 7 relocates the connection URL out of schema.prisma.
    expect(schema).not.toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
  });

  it('relocates the datasource url and seed into prisma.config.ts (Prisma 7)', () => {
    const config = readFileSync(join(__dirname, '../../prisma.config.ts'), 'utf-8');
    expect(config).toMatch(/datasource\s*:\s*\{/);
    expect(config).toMatch(/url\s*:\s*process\.env\.DATABASE_URL/);
    expect(config).toMatch(/seed\s*:\s*'tsx prisma\/seed\.ts'/);
  });

  describe.each([
    { model: 'Client', map: 'clients' },
    { model: 'Unit', map: 'units' },
    { model: 'ProductCategory', map: 'product_categories' },
    { model: 'Product', map: 'products' },
  ])('model $model', ({ model, map }) => {
    const block = new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`);

    it('exists', () => {
      expect(schema).toMatch(block);
    });

    it('has the baseline id, name, createdAt, updatedAt fields and @@map', () => {
      const match = schema.match(block);
      expect(match).not.toBeNull();
      const body = match?.[0] ?? '';
      expect(body).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/);
      // `name` presence only — per-model uniqueness is asserted separately below
      // (Client keys on slug; Product/Category are unique per tenant).
      expect(body).toMatch(/name\s+String/);
      expect(body).toMatch(/createdAt\s+DateTime/);
      expect(body).toMatch(/updatedAt\s+DateTime/);
      expect(body).toMatch(new RegExp(`@@map\\("${map}"\\)`));
    });
  });

  describe('multi-tenant uniqueness (slug + per-tenant catalog)', () => {
    const clientBlock = schema.match(/model\s+Client\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    const unitBlock = schema.match(/model\s+Unit\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    const productBlock = schema.match(/model\s+Product\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    const categoryBlock =
      schema.match(/model\s+ProductCategory\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

    it('keys the tenant (Client) on a unique slug, with a non-unique name and a status', () => {
      expect(clientBlock).toMatch(/slug\s+String\s+@unique/);
      // `name` is a display label — no longer globally unique.
      expect(clientBlock).not.toMatch(/\bname\s+String\s+@unique/);
      expect(clientBlock).toMatch(/status\s+String\s+@default\("ACTIVE"\)/);
    });

    it('keeps Unit.name globally unique (shared reference data)', () => {
      expect(unitBlock).toMatch(/name\s+String\s+@unique/);
    });

    it('makes catalog names unique PER TENANT via @@unique([clientId, name])', () => {
      expect(productBlock).toMatch(/@@unique\(\[clientId,\s*name\]\)/);
      expect(productBlock).not.toMatch(/\bname\s+String\s+@unique/);
      expect(categoryBlock).toMatch(/@@unique\(\[clientId,\s*name\]\)/);
      expect(categoryBlock).not.toMatch(/\bname\s+String\s+@unique/);
    });
  });

  describe('Client address + coordinates (FUT-116, stores-near-you discovery)', () => {
    const clientBlock = schema.match(/model\s+Client\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

    it('adds optional address fields mapped to snake_case columns', () => {
      expect(clientBlock).toMatch(/addressLine\s+String\?\s+@map\("address_line"\)/);
      expect(clientBlock).toMatch(/city\s+String\?/);
      expect(clientBlock).toMatch(/state\s+String\?/);
      expect(clientBlock).toMatch(/postalCode\s+String\?\s+@map\("postal_code"\)/);
    });

    it('adds optional float8 coordinates with the bounding-box index', () => {
      expect(clientBlock).toMatch(/latitude\s+Float\?/);
      expect(clientBlock).toMatch(/longitude\s+Float\?/);
      expect(clientBlock).toMatch(/@@index\(\[latitude,\s*longitude\]\)/);
    });
  });

  it('defines the Membership join (per-tenant roles over a shared user)', () => {
    const body = schema.match(/model\s+Membership\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(body).not.toBe('');
    expect(body).toMatch(/userId\s+String\s+@map\("user_id"\)/);
    expect(body).toMatch(/clientId\s+String\s+@map\("client_id"\)/);
    expect(body).toMatch(/role\s+String\s+@default\("CUSTOMER"\)/);
    expect(body).toMatch(/@@unique\(\[userId,\s*clientId\]\)/);
    expect(body).toMatch(/@@map\("memberships"\)/);
  });

  it('defines an Inventory model (per-product stock)', () => {
    const inventoryBlock = schema.match(/model\s+Inventory\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(inventoryBlock).not.toBe('');
    // One inventory row per product, stock as an integer quantity.
    expect(inventoryBlock).toMatch(/productId\s+String\s+@unique/);
    expect(inventoryBlock).toMatch(/quantity\s+Int/);
    expect(inventoryBlock).toMatch(/@@map\("inventory"\)/);
  });

  // FUT-7 (checkout) adds the order/payment domain models, and FUT-44 links a
  // cart to a user. These superseded the starter's "no Order model yet" guard —
  // we now validate the models are present with their expected table maps.
  describe.each([
    { model: 'Order', map: 'orders' },
    { model: 'OrderItem', map: 'order_items' },
    { model: 'Payment', map: 'payments' },
    { model: 'SavedCard', map: 'saved_cards' },
  ])('checkout model $model', ({ model, map }) => {
    it('exists and maps to its table', () => {
      const body = schema.match(new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
      expect(body).not.toBe('');
      expect(body).toMatch(new RegExp(`@@map\\("${map}"\\)`));
    });
  });

  it('links a cart to a user per tenant (cart-per-user, FUT-44; multi-tenant)', () => {
    const cartBlock = schema.match(/model\s+Cart\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(cartBlock).not.toBe('');
    expect(cartBlock).toMatch(/userId\s+String\?\s+@map\("user_id"\)/);
    // One cart per (user, tenant) — no longer globally unique on user_id.
    expect(cartBlock).toMatch(/@@unique\(\[userId,\s*clientId\]\)/);
    expect(cartBlock).not.toMatch(/userId\s+String\?\s+@unique/);
  });

  describe('Product catalog fields and relations', () => {
    const productBlock = schema.match(/model\s+Product\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    const categoryBlock =
      schema.match(/model\s+ProductCategory\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

    it('scopes Product to a client and an optional category', () => {
      expect(productBlock).toMatch(/clientId\s+String\s+@map\("client_id"\)/);
      expect(productBlock).toMatch(/categoryId\s+String\?\s+@map\("category_id"\)/);
      expect(productBlock).toMatch(/client\s+Client\s+@relation/);
      expect(productBlock).toMatch(/category\s+ProductCategory\?\s+@relation/);
    });

    it('stores money as integer cents with a BRL default and an active flag', () => {
      expect(productBlock).toMatch(/priceCents\s+Int\s+@map\("price_cents"\)/);
      expect(productBlock).toMatch(/currency\s+String\s+@default\("BRL"\)/);
      expect(productBlock).toMatch(/active\s+Boolean\s+@default\(true\)/);
      expect(productBlock).toMatch(/imageKey\s+String\?\s+@map\("image_key"\)/);
    });

    it('scopes ProductCategory to a client and supports nesting', () => {
      expect(categoryBlock).toMatch(/clientId\s+String\s+@map\("client_id"\)/);
      expect(categoryBlock).toMatch(/client\s+Client\s+@relation/);
      expect(categoryBlock).toMatch(/parentId\s+String\?\s+@map\("parent_id"\)/);
      expect(categoryBlock).toMatch(/parent\s+ProductCategory\?\s+@relation/);
      expect(categoryBlock).toMatch(/children\s+ProductCategory\[\]/);
    });
  });
});
