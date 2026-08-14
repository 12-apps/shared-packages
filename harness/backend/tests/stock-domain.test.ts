import { describe, expect, it } from 'vitest';

import {
  defineStockReasonTaxonomy,
  defineVocabulary,
  StockDomainConfigError,
  StockValueError,
} from '@12-apps/stock-domain';

/**
 * @12-apps/stock-domain from the TARBALL, wired the way an adopter wires it.
 *
 * The package's own suite already covers its rules; what it structurally cannot
 * cover is whether a consumer can reach them. This package publishes SOURCE —
 * `exports` points at `./src/index.ts` — so its entry point is a file `files`
 * must ship and a bundler must be able to compile, and every failure mode there
 * is invisible from inside a workspace where every sibling resolves whether or
 * not its manifest says so.
 *
 * The vocabulary below belongs to a bonded-warehouse spirits store: a domain
 * neither this repository nor the application the package was extracted from
 * has anything to do with. That is the point — the values are the consumer's,
 * they arrive as config, and nothing about them is recognised here.
 */
const casks = () =>
  defineStockReasonTaxonomy({
    kinds: {
      name: 'cask movement',
      values: ['DRAWN', 'FILLED', 'REGAUGED'],
      fallback: 'DRAWN',
    },
    categories: {
      name: 'ullage class',
      values: ['ANGELS_SHARE', 'LEAKAGE', 'SAMPLING'],
      fallback: 'SAMPLING',
    },
    categoryAppliesTo: ['DRAWN', 'REGAUGED'],
  });

describe('@12-apps/stock-domain — the published entry point works for a consumer', () => {
  it('assembles a taxonomy out of the consumer’s own values', () => {
    const CASKS = casks();
    expect([...CASKS.kinds.values]).toEqual(['DRAWN', 'FILLED', 'REGAUGED']);
    expect([...CASKS.categories.values]).toEqual(['ANGELS_SHARE', 'LEAKAGE', 'SAMPLING']);
    expect(CASKS.kinds.fallback).toBe('DRAWN');
  });

  it('narrows a stored row and refuses one that is not a member', () => {
    const CASKS = casks();
    expect(CASKS.coerceReason({ kind: 'FILLED', category: 'LEAKAGE' })).toEqual({
      // FILLED takes no ullage class, so the column carries the inert value.
      kind: 'FILLED',
      category: 'SAMPLING',
    });
    expect(CASKS.coerceReason({ kind: 'from-a-legacy-import', category: 'x' })).toEqual({
      kind: 'DRAWN',
      category: 'SAMPLING',
    });
    expect(() => CASKS.categoryFor('DRAWN', 'EVAPORATION')).toThrow(StockValueError);
    // A kind that is not a kind is a refusal, not the inert value — the third
    // case, and the one a consumer reaches by passing a raw wire string.
    expect(() => CASKS.categoryFor('DRAWNN', 'LEAKAGE')).toThrow(StockValueError);
  });

  it('refuses a value split out of a setting with the space still on it', () => {
    // The no-compiler path, from a consumer: `"A, B".split(',')` is how an
    // operator's comma-separated setting arrives, and accepting it would
    // publish `" FILLED"` to the write side while the read side coerced every
    // stored `FILLED` to the fallback.
    expect(() =>
      defineVocabulary({
        name: 'cask movement',
        values: 'DRAWN, FILLED'.split(','),
        fallback: 'DRAWN',
      }),
    ).toThrow(StockDomainConfigError);
  });

  it('hands the write side a tuple a schema library will accept', () => {
    // The shape `z.enum` and its equivalents ask for: a non-empty array whose
    // members are the same ones the read predicate accepts. Asserted here
    // because a consumer is where a widened `string[]` would actually bite.
    const CASKS = casks();
    const options = CASKS.categories.values;
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(CASKS.categories.has(option)).toBe(true);
    expect(Object.isFrozen(options)).toBe(true);
  });

  it('refuses an empty vocabulary at assembly, from the published entry', () => {
    // The guard has to be reachable through the door a consumer opens — not
    // only from some factory inside the package.
    expect(() => defineVocabulary({ name: 'cask movement', values: [], fallback: 'DRAWN' })).toThrow(
      StockDomainConfigError,
    );
    expect(() =>
      defineStockReasonTaxonomy({
        kinds: { name: 'cask movement', values: ['DRAWN'], fallback: 'DRAWN' },
        categories: { name: 'ullage class', values: ['LEAKAGE'], fallback: 'LEAKAGE' },
        categoryAppliesTo: [],
      }),
    ).toThrow(StockDomainConfigError);
  });
});
