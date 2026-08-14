import { describe, expect, it } from 'vitest';

import { StockDomainConfigError, StockValueError } from '../errors';
import { defineStockReasonTaxonomy, type StockReasonTaxonomy } from '../taxonomy';

/**
 * The fixture is a transfusion service's unit ledger — a domain this package was
 * not extracted from, so nothing here can pass by recognising a value.
 *
 * `ISSUE` deliberately names BOTH a direction (units leaving the bank) and a
 * sub-classification of one (a unit lost during issue). That overlap is the
 * property the old suite covered with two of its own values, and it is why
 * reading a row's category tells a caller nothing about its direction.
 */
function bloodBank(): StockReasonTaxonomy<'ISSUE' | 'DONATION', 'HAEMOLYSIS' | 'EXPIRY' | 'ISSUE'> {
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

describe('assembly refusals on the axis rule', () => {
  it('refuses an empty categoryAppliesTo, which discards every category silently', () => {
    expect(() =>
      defineStockReasonTaxonomy({
        kinds: { name: 'direction', values: ['ISSUE', 'DONATION'], fallback: 'ISSUE' },
        categories: { name: 'class', values: ['EXPIRY'], fallback: 'EXPIRY' },
        categoryAppliesTo: [],
      }),
    ).toThrow(/categoryAppliesTo/);
  });

  it('refuses a kind that is not in the direction vocabulary', () => {
    expect(() =>
      defineStockReasonTaxonomy({
        kinds: { name: 'direction', values: ['ISSUE', 'DONATION'], fallback: 'ISSUE' },
        categories: { name: 'class', values: ['EXPIRY'], fallback: 'EXPIRY' },
        // @ts-expect-error — the compiler refuses the typo; so must the runtime,
        // for a host assembling from configuration it did not type.
        categoryAppliesTo: ['ISSUED'],
      }),
    ).toThrow(/"ISSUED" is not one of direction's values/);
  });

  it('names the AXIS when its whole spec is missing', () => {
    // Without this the spec reaches `defineVocabulary` as `undefined` and fails
    // on the label — `name: must be a non-blank string.` — which is true,
    // unhelpful, and identical for both axes.
    expect(() =>
      // @ts-expect-error — the compiler refuses the omission; a host assembling
      // from configuration has no compiler.
      defineStockReasonTaxonomy({
        categories: { name: 'class', values: ['EXPIRY'], fallback: 'EXPIRY' },
        categoryAppliesTo: [],
      }),
    ).toThrow(/^kinds: /);

    expect(() =>
      // @ts-expect-error — see above.
      defineStockReasonTaxonomy({
        kinds: { name: 'direction', values: ['ISSUE'], fallback: 'ISSUE' },
        categoryAppliesTo: ['ISSUE'],
      }),
    ).toThrow(/^categories: /);
  });

  it('refuses a repeated kind', () => {
    expect(() =>
      defineStockReasonTaxonomy({
        kinds: { name: 'direction', values: ['ISSUE', 'DONATION'], fallback: 'ISSUE' },
        categories: { name: 'class', values: ['EXPIRY'], fallback: 'EXPIRY' },
        categoryAppliesTo: ['ISSUE', 'ISSUE'],
      }),
    ).toThrow(/named more than once/);
  });

  it('carries both axes through the same vocabulary refusals', () => {
    // The documented adoption path is THIS factory, so every guard
    // `defineVocabulary` makes has to be reachable from here — a guard only the
    // other entry point reaches is a guard an adopter never meets.
    //
    // The `@ts-expect-error`s mark the same double protection as the vocabulary
    // suite's: an empty literal infers `never`, which the compiler already
    // refuses; the runtime refusal is for a host assembling from data.
    expect(() =>
      defineStockReasonTaxonomy({
        // @ts-expect-error — see above.
        kinds: { name: 'direction', values: [], fallback: 'ISSUE' },
        categories: { name: 'class', values: ['EXPIRY'], fallback: 'EXPIRY' },
        // @ts-expect-error — with no kinds there is no kind to name here either.
        categoryAppliesTo: ['ISSUE'],
      }),
    ).toThrow(/direction\.values/);

    expect(() =>
      defineStockReasonTaxonomy({
        kinds: { name: 'direction', values: ['ISSUE'], fallback: 'ISSUE' },
        // @ts-expect-error — see above.
        categories: { name: 'class', values: [], fallback: 'EXPIRY' },
        categoryAppliesTo: ['ISSUE'],
      }),
    ).toThrow(/class\.values/);
  });
});

describe('which kinds take a category', () => {
  it('answers for a declared kind and refuses an undeclared one', () => {
    const taxonomy = bloodBank();
    expect(taxonomy.categoryApplies('ISSUE')).toBe(true);
    expect(taxonomy.categoryApplies('DONATION')).toBe(false);
  });

  it('refuses a value that is not a kind at all, rather than guessing', () => {
    const taxonomy = bloodBank();
    for (const value of ['issue', 'RECALL', '', null, undefined, 42, {}]) {
      expect(taxonomy.categoryApplies(value)).toBe(false);
    }
  });

  it('is frozen alongside the taxonomy it belongs to', () => {
    const taxonomy = bloodBank();
    expect(Object.isFrozen(taxonomy)).toBe(true);
    expect(Object.isFrozen(taxonomy.categoryAppliesTo)).toBe(true);
  });
});

describe('the write rule', () => {
  it('parses the category on a kind that takes one', () => {
    const taxonomy = bloodBank();
    expect(taxonomy.categoryFor('ISSUE', 'HAEMOLYSIS')).toBe('HAEMOLYSIS');
  });

  it('refuses a bad category rather than substituting one the user did not pick', () => {
    const taxonomy = bloodBank();
    expect(() => taxonomy.categoryFor('ISSUE', 'MISLABEL')).toThrow(StockValueError);
    expect(() => taxonomy.categoryFor('ISSUE', '')).toThrow(StockValueError);
    expect(() => taxonomy.categoryFor('ISSUE', undefined)).toThrow(StockValueError);
  });

  it('stores the inert fallback on a kind that takes no category', () => {
    const taxonomy = bloodBank();
    // Including when a category IS supplied: the column means nothing on this
    // row, so refusing the write over it would make the host invent a value.
    expect(taxonomy.categoryFor('DONATION', undefined)).toBe('ISSUE');
    expect(taxonomy.categoryFor('DONATION', 'HAEMOLYSIS')).toBe('ISSUE');
    expect(taxonomy.categoryFor('DONATION', 'nonsense')).toBe('ISSUE');
  });

  it('REFUSES a kind that is not in the vocabulary, rather than looking inert', () => {
    // The third case, and the one that is easy to fold into the second. An
    // unknown kind and a known-but-inapplicable one are not the same fact: the
    // first is a write that should never have been attempted, and answering it
    // with a clean-looking category discards the sub-classification the user
    // chose with nothing failing anywhere. That is the per-row form of the harm
    // an empty `categoryAppliesTo` is refused for.
    const taxonomy = bloodBank();
    expect(() => taxonomy.categoryFor('RECALL', 'HAEMOLYSIS')).toThrow(StockValueError);
    expect(() => taxonomy.categoryFor('issue', 'HAEMOLYSIS')).toThrow(StockValueError);
    for (const kind of [null, undefined, 42, {}, '']) {
      expect(() => taxonomy.categoryFor(kind, 'HAEMOLYSIS')).toThrow(StockValueError);
    }
  });

  it('tells an INVALID kind apart from an INAPPLICABLE one', () => {
    const taxonomy = bloodBank();
    // Inapplicable: a real kind that takes no category — inert value, no throw.
    expect(taxonomy.categoryFor('DONATION', 'HAEMOLYSIS')).toBe('ISSUE');
    // Invalid: not a kind at all — a refusal, even though the same inert value
    // would have been a perfectly plausible answer.
    expect(() => taxonomy.categoryFor('DONATIONS', 'HAEMOLYSIS')).toThrow(StockValueError);
  });
});

describe('the read rule', () => {
  it('narrows a well-formed row unchanged', () => {
    const taxonomy = bloodBank();
    expect(taxonomy.coerceReason({ kind: 'ISSUE', category: 'EXPIRY' })).toEqual({
      kind: 'ISSUE',
      category: 'EXPIRY',
    });
  });

  it('falls back rather than throwing, so one bad row does not take a screen down', () => {
    const taxonomy = bloodBank();
    expect(taxonomy.coerceReason({ kind: 'legacy', category: 'legacy' })).toEqual({
      kind: 'ISSUE',
      category: 'ISSUE',
    });
  });

  it('reports the inert fallback on a kind that takes no category', () => {
    const taxonomy = bloodBank();
    expect(taxonomy.coerceReason({ kind: 'DONATION', category: 'HAEMOLYSIS' })).toEqual({
      kind: 'DONATION',
      category: 'ISSUE',
    });
  });

  it('agrees with the write rule about which values are members', () => {
    // Lenient and strict may differ about what happens to a REJECTED value.
    // They may not differ about which values are rejected — that is the drift
    // this package exists to make impossible.
    const taxonomy = bloodBank();
    const corpus = ['HAEMOLYSIS', 'EXPIRY', 'ISSUE', 'MISLABEL', '', 'issue', 'constructor'];
    for (const value of corpus) {
      const accepted = taxonomy.categories.has(value);
      const written = (() => {
        try {
          return taxonomy.categoryFor('ISSUE', value);
        } catch {
          return null;
        }
      })();
      const read = taxonomy.coerceReason({ kind: 'ISSUE', category: value }).category;
      expect(written !== null).toBe(accepted);
      if (accepted) {
        expect(written).toBe(value);
        expect(read).toBe(value);
      } else {
        expect(read).toBe(taxonomy.categories.fallback);
      }
    }
  });
});

describe('the two axes are independent', () => {
  it('an overlapping value belongs to both axes independently', () => {
    const taxonomy = bloodBank();
    // `ISSUE` is a direction AND a sub-classification…
    expect(taxonomy.kinds.has('ISSUE')).toBe(true);
    expect(taxonomy.categories.has('ISSUE')).toBe(true);
    // …while a value on one axis is not admitted by the other.
    expect(taxonomy.kinds.has('HAEMOLYSIS')).toBe(false);
    expect(taxonomy.categories.has('DONATION')).toBe(false);
  });

  it('needs no overlap either — disjoint axes assemble just as happily', () => {
    const taxonomy = defineStockReasonTaxonomy({
      kinds: { name: 'direction', values: ['OUTBOUND', 'INBOUND'], fallback: 'OUTBOUND' },
      categories: { name: 'class', values: ['EXPIRY', 'HAEMOLYSIS'], fallback: 'EXPIRY' },
      categoryAppliesTo: ['OUTBOUND'],
    });
    expect(taxonomy.categoryFor('OUTBOUND', 'HAEMOLYSIS')).toBe('HAEMOLYSIS');
    expect(taxonomy.categoryFor('INBOUND', 'HAEMOLYSIS')).toBe('EXPIRY');
  });

  it('refuses at assembly rather than at the first request', () => {
    // The distinction the two error classes exist for: a wiring mistake is
    // found by booting, a data one by serving.
    expect(() =>
      defineStockReasonTaxonomy({
        kinds: { name: 'direction', values: ['ISSUE'], fallback: 'ISSUE' },
        categories: { name: 'class', values: ['EXPIRY'], fallback: 'EXPIRY' },
        categoryAppliesTo: [],
      }),
    ).toThrow(StockDomainConfigError);
    expect(() => bloodBank().categories.parse('MISLABEL')).toThrow(StockValueError);
  });
});
