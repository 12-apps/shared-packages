import { assertLocaleParity } from '@12-apps/i18n/testing';
import { describe, expect, it } from 'vitest';

import {
  MARKET_VOCABULARY,
  RESEARCH_BUDGET_COPY,
  RESEARCH_DIAGNOSTICS,
  RESEARCH_HTTP_MESSAGES,
} from '../locales';

/**
 * `tsc` already refuses a MISSING key. This covers the three drifts it cannot
 * see, and the two things specific to this package.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
describe('the locale packs', () => {
  it('speak both languages the same way', () => {
    assertLocaleParity('RESEARCH_HTTP_MESSAGES', RESEARCH_HTTP_MESSAGES);
    assertLocaleParity('RESEARCH_BUDGET_COPY', RESEARCH_BUDGET_COPY);
    assertLocaleParity('RESEARCH_DIAGNOSTICS', RESEARCH_DIAGNOSTICS);
  });

  it('does not hold the market vocabulary to copy parity, and here is why', () => {
    // `assertLocaleParity` compares array LENGTHS, which is right for a copy
    // pack — a list of strength bands or tutorial steps differing between
    // locales is a defect. `headerAliases` is the opposite kind of list: an
    // OPEN set of spellings a spreadsheet column might use, and two markets
    // having different numbers of them is the normal case, not drift.
    //
    // Running the copy assertion here fails, and that failure is the type
    // system telling the truth: this is keyed by MARKET, not by reader. What
    // must hold instead is that every category is answered on both sides.
    const categories = Object.keys(MARKET_VOCABULARY['pt-BR']);
    expect(Object.keys(MARKET_VOCABULARY['en-US'])).toEqual(categories);
    const aliasKeys = Object.keys(MARKET_VOCABULARY['pt-BR'].headerAliases);
    expect(Object.keys(MARKET_VOCABULARY['en-US'].headerAliases)).toEqual(aliasKeys);
    for (const key of aliasKeys) {
      const aliases = MARKET_VOCABULARY['en-US'].headerAliases[key as keyof typeof MARKET_VOCABULARY['en-US']['headerAliases']];
      expect(aliases.length).toBeGreaterThan(0);
    }
  });

  it('says whether a PAID credit was consumed, in both', () => {
    // The difference between retrying freely and retrying at a cost. A
    // translation that dropped the parenthetical would leave an operator
    // unable to tell.
    for (const copy of Object.values(RESEARCH_DIAGNOSTICS)) {
      expect(copy.searchApi.creditMaybeSpent).not.toBe(copy.searchApi.creditNotSpent);
      expect(copy.searchApi.timedOutMaybeSpent('30s')).toContain('30s');
    }
  });

  it('keeps the vendor nouns an operator has to find elsewhere', () => {
    // VTEX and SearchApi name somebody else's dashboard. Translating them sends
    // an operator hunting for a control that does not exist under that name.
    for (const copy of Object.values(RESEARCH_DIAGNOSTICS)) {
      expect(copy.searchApi.prefixed('google', 'x')).toContain('SearchApi');
      expect(copy.vtex.tiers.simulation).toContain('VTEX');
    }
  });

  it('gives each market vocabulary its own phrasings', () => {
    // Keyed by MARKET, not by reader: these parse somebody else's storefront.
    // Sharing a pattern between them would mean one of the two was never
    // measured against the listings it is supposed to read.
    expect(MARKET_VOCABULARY['pt-BR'].outOfStock.source).not.toBe(
      MARKET_VOCABULARY['en-US'].outOfStock.source,
    );
    expect('Out of stock').toMatch(MARKET_VOCABULARY['en-US'].outOfStock);
    expect('esgotado').toMatch(MARKET_VOCABULARY['pt-BR'].outOfStock);
  });
});
