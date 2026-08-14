// @vitest-environment node
/**
 * EVERY PUBLIC DOOR REACHES THE GUARD.
 *
 * A prior package in this series shipped a correct assembly assertion that only
 * its surface factories called, while the entry point its own adoption guide
 * documented validated nothing. The guard was right, tested, and unreachable
 * from the path an adopter takes.
 *
 * So this suite does not test a guard. It enumerates the package's public
 * entry points from `package.json#exports`, enumerates what each one exports,
 * and refuses any factory that has no hazard case below. A new factory added
 * later fails HERE — before it can ship a second unguarded door — rather than
 * being noticed by whoever adopts it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as root from '../index';
import { StockDomainConfigError } from '../errors';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* eslint-disable test-flakiness/no-unmocked-fs --
   the manifest IS the subject: the question is what this package promises a
   consumer, and a mocked manifest would answer with what the test promised. */
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, string>;
};
/* eslint-enable test-flakiness/no-unmocked-fs */

/**
 * The hazard: a collection a host can declare EMPTY.
 *
 * One entry per factory, several cases per entry — every collection a factory
 * accepts gets its own, because "refuses an empty one" is a property of each
 * collection and not of the factory.
 */
const HAZARD_CASES: Record<string, { label: string; run: () => unknown }[]> = {
  defineVocabulary: [
    {
      label: 'no values',
      // @ts-expect-error — an empty literal infers `never`, so the compiler
      // refuses it as well. The runtime guard is what a host assembling its
      // axes from configuration data meets instead, and it is the one being
      // enumerated here.
      run: () => root.defineVocabulary({ name: 'axis', values: [], fallback: 'A' }),
    },
  ],
  defineStockReasonTaxonomy: [
    {
      label: 'no kinds',
      run: () =>
        root.defineStockReasonTaxonomy({
          // @ts-expect-error — see above.
          kinds: { name: 'kind', values: [], fallback: 'A' },
          categories: { name: 'category', values: ['B'], fallback: 'B' },
          // @ts-expect-error — with no kinds there is no kind to name here.
          categoryAppliesTo: ['A'],
        }),
    },
    {
      label: 'no categories',
      run: () =>
        root.defineStockReasonTaxonomy({
          kinds: { name: 'kind', values: ['A'], fallback: 'A' },
          // @ts-expect-error — see above.
          categories: { name: 'category', values: [], fallback: 'B' },
          categoryAppliesTo: ['A'],
        }),
    },
    {
      label: 'no applicable kinds',
      run: () =>
        root.defineStockReasonTaxonomy({
          kinds: { name: 'kind', values: ['A'], fallback: 'A' },
          categories: { name: 'category', values: ['B'], fallback: 'B' },
          categoryAppliesTo: [],
        }),
    },
  ],
};

/** Exported callables that are factories rather than error classes. */
function exportedFactories(module: Record<string, unknown>): string[] {
  return Object.entries(module)
    .filter(([, value]) => typeof value === 'function')
    .filter(([, value]) => !((value as { prototype?: unknown }).prototype instanceof Error))
    .map(([name]) => name)
    .sort();
}

describe('the published entry points', () => {
  it('are the ones this suite covers — there is no second door', () => {
    // `./package.json` is a file, not a module surface; every other subpath
    // must be one this file imports and enumerates.
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './package.json']);
    expect(manifest.exports['.']).toBe('./src/index.ts');
  });

  it('export exactly the factories that have a hazard case', () => {
    expect(exportedFactories(root)).toEqual(Object.keys(HAZARD_CASES).sort());
  });

  it('export the two error classes and nothing else callable', () => {
    const errors = Object.entries(root)
      .filter(([, value]) => (value as { prototype?: unknown }).prototype instanceof Error)
      .map(([name]) => name)
      .sort();
    expect(errors).toEqual(['StockDomainConfigError', 'StockValueError']);
  });
});

describe('every factory refuses an empty collection', () => {
  for (const [factory, cases] of Object.entries(HAZARD_CASES)) {
    for (const { label, run } of cases) {
      it(`${factory}: ${label}`, () => {
        expect(run).toThrow(StockDomainConfigError);
      });
    }
  }

  it('would notice if a case stopped being a case', () => {
    // Anti-vacuity: the loop above proves nothing if `HAZARD_CASES` is empty or
    // an entry's array is, and both are one bad edit away.
    const counts = Object.values(HAZARD_CASES).map((cases) => cases.length);
    expect(counts.length).toBeGreaterThan(0);
    expect(Math.min(...counts)).toBeGreaterThan(0);
  });
});
