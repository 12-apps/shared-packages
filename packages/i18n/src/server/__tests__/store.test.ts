import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPrismaLocaleStore, type LocaleDb, type LocaleStore } from '../store';

/**
 * The fact the whole locale axis needed and could never obtain.
 *
 * What is worth pinning here is the pair of asymmetries that make the storage
 * honest: absence is a VALUE ("has not chosen"), and clearing has to restore
 * absence rather than write a default. Get either wrong and a guess becomes
 * indistinguishable from a choice — which, since a reader's own setting
 * outranks the tenant's, silently beats a store language nobody chose to lose.
 */

// A CONTAINER, not bare bindings: reassigning a module-scope binding from
// inside a stub is shared mutable state, and a property is the way out.
const calls = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

const db = {
  localePreference: {
    findUnique: calls.findUnique,
    upsert: calls.upsert,
    deleteMany: calls.deleteMany,
  },
} as unknown as LocaleDb;

/**
 * Built PER TEST rather than once at module scope: `no-test-isolation` reads a
 * shared instance as order-dependent state, and the rule is right here — the
 * store closes over `getDb`, so one built once would outlive `resetAllMocks`.
 */
const newStore = (): LocaleStore => createPrismaLocaleStore({ getDb: async () => db });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('read', () => {
  it('answers the stored tag', async () => {
    calls.findUnique.mockResolvedValue({ locale: 'en-US' });
    expect(await newStore().read('u1')).toBe('en-US');
  });

  it('answers null when no row exists — the person has not chosen', async () => {
    calls.findUnique.mockResolvedValue(null);
    expect(await newStore().read('u1')).toBeNull();
  });

  it('discards a stored tag this package no longer speaks', async () => {
    // Validated on the way OUT as well as in. A value written by an older
    // release or a hand-run SQL fix must not become the one thing in the system
    // that never passed `matchLocale` — every reader downstream assumes it did.
    calls.findUnique.mockResolvedValue({ locale: 'klingon' });
    expect(await newStore().read('u1')).toBeNull();
  });
});

describe('write', () => {
  it('upserts a choice and answers what was stored', async () => {
    expect(await newStore().write('u1', 'en-US')).toBe('en-US');
    expect(calls.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      update: { locale: 'en-US' },
      create: { userId: 'u1', locale: 'en-US' },
    });
  });

  it('normalises, so the column holds one spelling per language', async () => {
    expect(await newStore().write('u1', 'pt-br' as 'pt-BR')).toBe('pt-BR');
    expect(calls.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { locale: 'pt-BR' } }),
    );
  });

  /**
   * The half that is easy to get wrong. Clearing must DELETE, because absence
   * is how "has not chosen" is stored — a row holding the default would keep
   * outranking the tenant's language forever, and would read in the database
   * exactly like somebody who had chosen pt-BR on purpose.
   */
  it('DELETES on null rather than storing a default', async () => {
    expect(await newStore().write('u1', null)).toBeNull();
    expect(calls.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(calls.upsert).not.toHaveBeenCalled();
  });

  it('refuses an unsupported tag instead of writing it', async () => {
    // Re-validated here and not only at the route: this store is callable
    // directly by a host's own code, so the wire is not the only way in.
    await expect(newStore().write('u1', 'klingon' as 'pt-BR')).rejects.toThrow(/Unsupported locale/);
    expect(calls.upsert).not.toHaveBeenCalled();
  });
});
