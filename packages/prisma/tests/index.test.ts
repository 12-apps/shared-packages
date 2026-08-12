import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module source as text, via Vite's `?raw` loader — deterministic and with
// no unmocked fs read (test-flakiness/no-unmocked-fs) — so the "module shape"
// assertions below can grep it. Vitest resolves `?raw`; the package's tsc run
// excludes tests, so no ambient declaration is needed.
import indexSource from '../src/index.ts?raw';

import {
  getPrismaClient,
  resetPrismaClient,
  setPrismaClient,
} from '../src/index';
import type { PrismaClient } from '../src/index';

// Spyable constructor mock for the generated client.
const constructorSpy = vi.fn();

// Mock @prisma/client so the typed import resolves to a controllable stub.
vi.mock('@prisma/client', () => {
  class PrismaClient {
    constructor(...args: unknown[]) {
      constructorSpy(...args);
    }

    $disconnect = vi.fn();
    $transaction = vi.fn();
    // The audit extension (FUT-168) wraps the client via `$extends`; the real
    // client returns an extended proxy — the stub returns itself so the
    // constructor assertions still hold.
    $extends(): unknown {
      return this;
    }
  }

  return { PrismaClient };
});

// Mock the Postgres driver adapter so the default branch builds without a real
// pg pool/connection. The mocked PrismaClient above records the { adapter, log }
// it is constructed with.
vi.mock('@prisma/adapter-pg', () => {
  class PrismaPg {}
  return { PrismaPg };
});

describe('prisma index module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrismaClient();
    // Prisma 7 makes the adapter mandatory and the default branch reads
    // DATABASE_URL to build it. Provide a dummy URL; @prisma/adapter-pg is
    // mocked above, so no real pg pool/connection is created.
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  });

  describe('getPrismaClient (AC1 — singleton)', () => {
    it('returns the same instance across calls', async () => {
      const first = await getPrismaClient();
      const second = await getPrismaClient();

      expect(first).toBe(second);
      expect(constructorSpy).toHaveBeenCalledTimes(1);
    });

    it('constructs the generated PrismaClient', async () => {
      await getPrismaClient();
      expect(constructorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('setPrismaClient / resetPrismaClient (AC2 — test seams)', () => {
    it('returns the injected stub from setPrismaClient', async () => {
      const stub = { $disconnect: vi.fn() } as Partial<PrismaClient> as PrismaClient;
      setPrismaClient(stub);

      const client = await getPrismaClient();

      expect(client).toBe(stub);
      expect(constructorSpy).not.toHaveBeenCalled();
    });

    it('rebuilds the client after resetPrismaClient', async () => {
      const stub = { $disconnect: vi.fn() } as Partial<PrismaClient> as PrismaClient;
      setPrismaClient(stub);
      await getPrismaClient();

      resetPrismaClient();
      const rebuilt = await getPrismaClient();

      expect(rebuilt).not.toBe(stub);
      expect(constructorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('module shape (AC3 — no hand-written stub types)', () => {
    it('does not declare the hand-written PrismaClientMethods stub', () => {
      expect(indexSource).not.toMatch(/PrismaClientMethods/);
    });

    it('does not declare hand-written User model stub types', () => {
      expect(indexSource).not.toMatch(/interface\s+User\b/);
      expect(indexSource).not.toMatch(/UserWithRelations/);
      expect(indexSource).not.toMatch(/UserInclude/);
    });

    it('re-exports the generated PrismaClient type from @prisma/client', () => {
      expect(indexSource).toMatch(/export\s+type\s+\{\s*PrismaClient\s*\}/);
    });

    it('uses a typed dynamic import rather than an unsafe cast', () => {
      expect(indexSource).not.toMatch(/\bas\s+any\b/);
    });
  });
});
