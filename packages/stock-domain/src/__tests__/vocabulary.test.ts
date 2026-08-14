import { describe, expect, it } from 'vitest';

import { StockDomainConfigError, StockValueError } from '../errors';
import { defineVocabulary } from '../vocabulary';

/**
 * WHAT HAPPENED TO THE OLD SUITE (`src/__tests__/index.test.ts`).
 *
 * That file's assertions were about a vocabulary this package no longer owns.
 * Every one of them is accounted for; none of the GENERIC ones was dropped
 * because its fixture named one application's values — those were re-fixtured,
 * which is the whole point.
 *
 * | Old assertion                                     | Disposition |
 * | ------------------------------------------------- | ----------- |
 * | the kinds array is exactly `[…, …]`               | dropped — host data. The host asserts its own array where it declares it; here `preserves declaration order` covers the property that made the old test worth writing. |
 * | the categories array is exactly `[…, …, …]`       | dropped — host data, same as above. |
 * | both defaults are `…`, matching the DB columns    | dropped — host data. The DB-column agreement is a host fact and belongs to the host's suite. |
 * | a default is inside its own vocabulary            | PROMOTED to a runtime refusal (`fallback` must be a member) and covered by `refuses a fallback that is not a member`. Was a test that a constant happened to be right; is now a guard no host can get wrong. |
 * | accepts every value in the vocabulary             | ported → `accepts every declared value`. |
 * | rejects near-misses and the wrong axis            | ported → `rejects near-misses`, re-fixtured onto a foreign vocabulary. |
 * | the two sets may overlap, so a category tells you nothing about the kind | ported → `taxonomy.test.ts` › `an overlapping value belongs to both axes independently`. |
 * | inherited Array members are not vocabulary        | ported verbatim → `does not treat inherited members as vocabulary`. |
 */

/**
 * A vocabulary from a domain this package was NOT extracted from — a
 * transfusion service's unit ledger. Nothing about the fixture is load-bearing
 * except that its words belong to somebody else.
 */
const ledger = () =>
  defineVocabulary({
    name: 'movement direction',
    values: ['ISSUE', 'DONATION'],
    fallback: 'ISSUE',
  });

describe('assembly refusals', () => {
  it('refuses an empty vocabulary, rather than reading it as a lockout', () => {
    // The `@ts-expect-error`s are load-bearing and say something on their own:
    // an empty literal makes `Value` infer as `never`, so there is no member
    // `fallback` could be and a host writing this in TypeScript is stopped in
    // the editor. The runtime refusal is for the host that does NOT — one
    // assembling its axes from a settings table, a JSON file or an environment
    // variable, where there is no compiler in the loop at all.
    // @ts-expect-error — see above.
    expect(() => defineVocabulary({ name: 'direction', values: [], fallback: 'ISSUE' })).toThrow(
      StockDomainConfigError,
    );
    // The message has to say WHICH field, because the alternative is an adopter
    // searching their assembly code for a sentence.
    // @ts-expect-error — see above.
    expect(() => defineVocabulary({ name: 'direction', values: [], fallback: 'ISSUE' })).toThrow(
      /direction\.values/,
    );
  });

  it('refuses a blank value, which every "is it filled in" check admits', () => {
    for (const blank of ['', ' ', '\t', '\n']) {
      expect(() =>
        defineVocabulary({ name: 'direction', values: ['ISSUE', blank], fallback: 'ISSUE' }),
      ).toThrow(StockDomainConfigError);
    }
  });

  it('refuses a value with surrounding whitespace', () => {
    for (const padded of [' ISSUE', 'ISSUE ', '\tISSUE', 'ISSUE\n']) {
      expect(() =>
        defineVocabulary({ name: 'direction', values: ['DONATION', padded], fallback: 'DONATION' }),
      ).toThrow(/has surrounding whitespace/);
    }
  });

  it('refuses the shape a comma-separated setting actually produces', () => {
    // The no-compiler path this package's runtime guards exist for, written out
    // as the operator writes it. Every consequence of accepting it is silent:
    // the published enum would carry `" INBOUND"`, so the write validator
    // refuses every stored `INBOUND` while the read path coerces the whole
    // column to the fallback — on the axis that decides a movement's sign.
    const typed = 'OUTBOUND, INBOUND';
    const values = typed.split(',');
    expect(values).toEqual(['OUTBOUND', ' INBOUND']);
    expect(() =>
      defineVocabulary({ name: 'direction', values, fallback: 'OUTBOUND' }),
    ).toThrow(StockDomainConfigError);
    // …and the same declaration, split the way it was meant to be, assembles.
    const vocabulary = defineVocabulary({
      name: 'direction',
      values: typed.split(',').map((value) => value.trim()),
      fallback: 'OUTBOUND',
    });
    expect(vocabulary.has('INBOUND')).toBe(true);
    expect(vocabulary.coerce('INBOUND')).toBe('INBOUND');
  });

  it('refuses a padded fallback, and says so rather than listing the values', () => {
    expect(() =>
      defineVocabulary({
        name: 'direction',
        values: ['ISSUE', 'DONATION'],
        // @ts-expect-error — a NoInfer position, so the compiler sees it too.
        fallback: 'ISSUE ',
      }),
    ).toThrow(/has surrounding whitespace/);
  });

  it('refuses a near-duplicate, which the duplicate check alone cannot see', () => {
    // `['OUT', 'OUT ']` is two entries by every length check and one value by
    // every reader. It fails on the whitespace rule before reaching the
    // duplicate one, which is the only reason the duplicate rule can be sold as
    // protecting a length-based drift test.
    expect(() =>
      defineVocabulary({ name: 'direction', values: ['ISSUE', 'ISSUE '], fallback: 'ISSUE' }),
    ).toThrow(StockDomainConfigError);
  });

  it('refuses a duplicate, which hides a widening from a length check', () => {
    expect(() =>
      defineVocabulary({
        name: 'direction',
        values: ['ISSUE', 'DONATION', 'ISSUE'],
        fallback: 'ISSUE',
      }),
    ).toThrow(/"ISSUE" is declared more than once/);
  });

  it('refuses a fallback that is not a member', () => {
    expect(() =>
      defineVocabulary({
        name: 'direction',
        values: ['ISSUE', 'DONATION'],
        // @ts-expect-error — the compiler refuses it too, and only because
        // `fallback` is a NoInfer position: left inferrable, this line would
        // simply widen the vocabulary to include itself and compile clean.
        fallback: 'RECALL',
      }),
    ).toThrow(/direction\.fallback/);
  });

  it('refuses a blank axis name, which error messages are useless without', () => {
    expect(() =>
      defineVocabulary({ name: '  ', values: ['ISSUE'], fallback: 'ISSUE' }),
    ).toThrow(StockDomainConfigError);
  });

  it('refuses a non-array values field', () => {
    expect(() =>
      defineVocabulary({
        name: 'direction',
        // @ts-expect-error — same reason as the fallback case above.
        values: 'ISSUE',
        fallback: 'ISSUE',
      }),
    ).toThrow(/direction\.values/);
  });
});

describe('the one predicate', () => {
  it('accepts every declared value', () => {
    const vocabulary = ledger();
    for (const value of vocabulary.values) expect(vocabulary.has(value)).toBe(true);
  });

  it('rejects near-misses', () => {
    const vocabulary = ledger();
    for (const value of ['', 'issue', 'Issue', 'ISSUES', ' ISSUE', 'ISSUE ', 'RECALL']) {
      expect(vocabulary.has(value)).toBe(false);
    }
  });

  it('rejects non-strings without stringifying them', () => {
    const vocabulary = ledger();
    for (const value of [null, undefined, 0, false, {}, ['ISSUE'], new String('ISSUE')]) {
      expect(vocabulary.has(value)).toBe(false);
    }
  });

  it('does not treat inherited members as vocabulary', () => {
    const vocabulary = ledger();
    for (const value of ['length', 'constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(vocabulary.has(value)).toBe(false);
    }
  });

  it('is the same test parse and coerce run — they differ only on the refusal', () => {
    const vocabulary = ledger();
    const corpus = [
      ...vocabulary.values,
      '',
      'issue',
      'ISSUES',
      ' ISSUE',
      'RECALL',
      'constructor',
    ];
    for (const value of corpus) {
      const accepted = vocabulary.has(value);
      const parsed = (() => {
        try {
          return { ok: true as const, value: vocabulary.parse(value) };
        } catch {
          return { ok: false as const };
        }
      })();
      expect(parsed.ok).toBe(accepted);
      if (parsed.ok) expect(parsed.value).toBe(value);
      expect(vocabulary.coerce(value)).toBe(accepted ? value : vocabulary.fallback);
    }
  });

  it('throws a StockValueError from parse — a data failure, not a config one', () => {
    const vocabulary = ledger();
    expect(() => vocabulary.parse('RECALL')).toThrow(StockValueError);
    expect(() => vocabulary.parse('RECALL')).not.toThrow(StockDomainConfigError);
  });

  it('truncates an oversized value rather than logging it whole', () => {
    const vocabulary = ledger();
    const flood = 'x'.repeat(5_000);
    const message = (() => {
      try {
        vocabulary.parse(flood);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message.length).toBeLessThan(120);
    expect(message).toContain('…');
  });
});

describe('what a write is validated against and what a read is narrowed with', () => {
  it('is one frozen copy, so nothing the host still holds can move it', () => {
    const declared = ['ISSUE', 'DONATION'];
    const vocabulary = defineVocabulary({
      name: 'movement direction',
      values: declared,
      fallback: 'ISSUE',
    });

    // The host mutates the array it passed in — the shape of an accident, not
    // of malice: a module that builds its list at load time and appends later.
    declared.push('RECALL');

    expect(vocabulary.values).toEqual(['ISSUE', 'DONATION']);
    expect(vocabulary.has('RECALL')).toBe(false);
    expect(Object.isFrozen(vocabulary.values)).toBe(true);
  });

  it('cannot be widened through the exposed array either', () => {
    const vocabulary = ledger();
    // Frozen, so a stray push is a no-op in sloppy mode and a throw in strict —
    // either way the set the read predicate uses does not move. The double cast
    // is the point: reaching the array as something mutable is what a host
    // would have to write on purpose, and it still cannot widen the set.
    expect(() => (vocabulary.values as unknown as string[]).push('RECALL')).toThrow(TypeError);
    expect(vocabulary.has('RECALL')).toBe(false);
  });

  it('preserves declaration order, because a host publishes this array', () => {
    const vocabulary = defineVocabulary({
      name: 'direction',
      values: ['DONATION', 'ISSUE', 'RECALL'],
      fallback: 'RECALL',
    });
    expect([...vocabulary.values]).toEqual(['DONATION', 'ISSUE', 'RECALL']);
  });

  it('guarantees the fallback survives the write gate it round-trips into', () => {
    const vocabulary = ledger();
    // The read path can mint `fallback` out of a malformed row; that value is
    // then written back by any save on that screen. If it were not a member the
    // host's own write validator would refuse a value this package produced.
    expect(vocabulary.has(vocabulary.coerce('nonsense-from-a-legacy-row'))).toBe(true);
    expect(vocabulary.values).toContain(vocabulary.fallback);
  });
});
