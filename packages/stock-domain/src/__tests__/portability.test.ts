import { describe, expect, it } from 'vitest';

import { StockValueError } from '../errors';
import { defineStockReasonTaxonomy, type StockReasonTaxonomy } from '../taxonomy';
import type { VocabularyValue } from '../vocabulary';
import { foreignPatterns } from './foreign-vocabulary';

/**
 * TWO HOSTS, NEITHER OF THEM THE ONE THIS PACKAGE CAME OUT OF.
 *
 * A portability claim is only worth what it is tested against. Asserting that
 * the package still works for the application it was extracted from proves
 * nothing: that application's vocabulary is the one that used to be compiled
 * in. So both hosts below are built from words the extraction's origin does not
 * use, in domains it does not touch, and they are mounted in the SAME process —
 * because a package that quietly keeps module-scope state serves the first host
 * correctly and the second one somebody else's values.
 *
 * They also differ in ARITY on every axis (2/3/1 against 3/5/2), so nothing can
 * pass by having been written for a two-by-three taxonomy.
 */

/** A transfusion service's unit ledger. */
function transfusionService() {
  return defineStockReasonTaxonomy({
    kinds: { name: 'movement direction', values: ['ISSUE', 'DONATION'], fallback: 'ISSUE' },
    categories: {
      name: 'shrinkage class',
      values: ['HAEMOLYSIS', 'EXPIRY', 'ISSUE'],
      fallback: 'ISSUE',
    },
    categoryAppliesTo: ['ISSUE'],
  });
}

/** A glacier ice-core archive. */
function coreArchive() {
  return defineStockReasonTaxonomy({
    kinds: {
      name: 'core movement',
      values: ['SUBLIMATION', 'RECOVERY', 'LOAN_OUT'],
      fallback: 'SUBLIMATION',
    },
    categories: {
      name: 'degradation',
      values: ['MELTWATER', 'FRACTURE', 'CONTAMINATION', 'MISLABEL', 'UNRECORDED'],
      fallback: 'UNRECORDED',
    },
    categoryAppliesTo: ['SUBLIMATION', 'LOAN_OUT'],
  });
}

/**
 * The WRITE gate a host builds, standing in for its schema library.
 *
 * Typed exactly as `z.enum` and its equivalents are — a non-empty readonly
 * tuple — so the shape of `Vocabulary.values` is checked by the compiler here
 * and not only by an assertion. A `readonly string[]` would not satisfy it,
 * which is the whole reason the tuple type is part of the contract.
 */
function enumOf<const T extends readonly [string, ...string[]]>(values: T) {
  const admitted = new Set<string>(values);
  return {
    options: values,
    parse(value: unknown): T[number] {
      if (typeof value === 'string' && admitted.has(value)) return value as T[number];
      throw new Error(`not one of ${values.join(', ')}`);
    },
  };
}

/**
 * The whole seam an adopter wires, mounted for real: a wire validator built
 * from the published values, a store holding rows the validator never saw, and
 * the two screens that read them back.
 */
function mountHost<Kind extends string, Category extends string>(
  taxonomy: StockReasonTaxonomy<Kind, Category>,
) {
  const kindEnum = enumOf(taxonomy.kinds.values);
  const categoryEnum = enumOf(taxonomy.categories.values);
  const rows: { kind: string; category: string }[] = [];

  return {
    kindEnum,
    categoryEnum,
    /** The endpoint: validate the wire, then apply the taxonomy's write rule. */
    create(body: { kind: unknown; category: unknown }) {
      const kind = kindEnum.parse(body.kind);
      const category = taxonomy.categoryFor(kind, body.category);
      rows.push({ kind, category });
      return { kind, category };
    },
    /** A row that predates the vocabulary, written by nothing this host runs. */
    plantLegacyRow(kind: string, category: string) {
      rows.push({ kind, category });
    },
    /** The list screen: narrow whatever storage holds. */
    list() {
      return rows.map((row) => taxonomy.coerceReason(row));
    },
  };
}

describe('a host that is not the one this package came from', () => {
  it('mounts, writes and reads its own vocabulary end to end', () => {
    const taxonomy = transfusionService();
    const host = mountHost(taxonomy);

    expect(host.create({ kind: 'ISSUE', category: 'HAEMOLYSIS' })).toEqual({
      kind: 'ISSUE',
      category: 'HAEMOLYSIS',
    });
    // A direction that takes no sub-classification stores the inert value.
    expect(host.create({ kind: 'DONATION', category: undefined })).toEqual({
      kind: 'DONATION',
      category: 'ISSUE',
    });
    expect(host.list()).toEqual([
      { kind: 'ISSUE', category: 'HAEMOLYSIS' },
      { kind: 'DONATION', category: 'ISSUE' },
    ]);
  });

  it('refuses at the wire what the taxonomy refuses, and refuses it first', () => {
    const host = mountHost(transfusionService());
    expect(() => host.create({ kind: 'RECALL', category: 'EXPIRY' })).toThrow(/not one of/);
    expect(() => host.create({ kind: 'ISSUE', category: 'MISLABEL' })).toThrow(StockValueError);
    expect(host.list()).toEqual([]);
  });

  it('narrows a row its own validator never saw', () => {
    const host = mountHost(transfusionService());
    host.plantLegacyRow('RETURNED', 'CLERICAL');
    expect(host.list()).toEqual([{ kind: 'ISSUE', category: 'ISSUE' }]);
  });

  it('publishes a wire enum whose members are exactly what the reader accepts', () => {
    // The read/write agreement, asserted where an adopter actually has two
    // things: an enum in a schema, and a narrowing in a repository.
    const taxonomy = coreArchive();
    const host = mountHost(taxonomy);
    const corpus = [
      ...taxonomy.categories.values,
      'meltwater',
      'MELTWATER ',
      '',
      'constructor',
      'BRINE',
    ];
    for (const value of corpus) {
      const wireAccepts = (() => {
        try {
          host.categoryEnum.parse(value);
          return true;
        } catch {
          return false;
        }
      })();
      expect(wireAccepts).toBe(taxonomy.categories.has(value));
    }
    expect([...host.kindEnum.options]).toEqual(['SUBLIMATION', 'RECOVERY', 'LOAN_OUT']);
  });
});

describe('two hosts in one process', () => {
  it('do not see each other’s vocabulary', () => {
    const bank = transfusionService();
    const archive = coreArchive();

    expect(bank.kinds.has('SUBLIMATION')).toBe(false);
    expect(archive.kinds.has('ISSUE')).toBe(false);
    expect(bank.categories.has('MELTWATER')).toBe(false);
    expect(archive.categories.has('HAEMOLYSIS')).toBe(false);
  });

  it('keep their own inert value and their own applicable kinds', () => {
    const bank = transfusionService();
    const archive = coreArchive();

    expect(bank.coerceReason({ kind: 'x', category: 'y' })).toEqual({
      kind: 'ISSUE',
      category: 'ISSUE',
    });
    expect(archive.coerceReason({ kind: 'x', category: 'y' })).toEqual({
      kind: 'SUBLIMATION',
      category: 'UNRECORDED',
    });
    expect(archive.categoryApplies('RECOVERY')).toBe(false);
    expect(archive.categoryApplies('LOAN_OUT')).toBe(true);
  });

  it('let a host name its own union off the published values', () => {
    const archive = coreArchive();
    type ArchiveKind = VocabularyValue<typeof archive.kinds>;
    // The compiler is the assertion; the runtime line keeps the binding used.
    const loaned: ArchiveKind = 'LOAN_OUT';
    expect(archive.kinds.has(loaned)).toBe(true);
  });
});

describe('the fixtures themselves', () => {
  /**
   * The anti-vacuity guard for the SUITE above: a portability proof written in
   * the extraction origin's own words proves nothing, and would look identical
   * to this file.
   *
   * It checks against `foreignPatterns()` — IMPORTED, not restated. A previous
   * revision of this case wrote its own regex covering eight of the sweep's
   * entries while claiming in a comment to use "the same one", which is two
   * statements of a set that can drift: precisely the defect the package this
   * suite is testing exists to remove.
   */
  it('share no word with the application this package was extracted from', () => {
    const fixtureWords = [
      transfusionService(),
      coreArchive(),
    ].flatMap((taxonomy) => [...taxonomy.kinds.values, ...taxonomy.categories.values]);

    const bans = foreignPatterns();
    for (const word of fixtureWords) {
      expect(bans.filter(({ pattern }) => pattern.test(word)).map(({ label }) => label)).toEqual([]);
    }
    // Anti-vacuity for the guard itself: a loop over an empty list passes, and
    // so does one over a list that lost the deliberate cross-axis duplicate the
    // overlap cases depend on. Both facts are pinned rather than counted loosely.
    expect(fixtureWords).toHaveLength(13);
    expect(new Set(fixtureWords).size).toBe(12);
    // …and the list it checks against is the real one, with the entries a
    // hand-written copy dropped.
    expect(bans.map(({ label }) => label)).toEqual(
      expect.arrayContaining(['SPOILAGE', 'R$', 'future-pay', 'fornecedor', 'loss_tracking']),
    );
    expect(bans.some(({ pattern }) => pattern.test('a SPOILAGE reason'))).toBe(true);
  });
});
