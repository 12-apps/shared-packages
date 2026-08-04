import { describe, expect, it } from 'vitest';
import {
  compareTermMatchRank,
  distinctiveTermTokens,
  matchResearchTerm,
} from '../scoring/term-match';

describe('matchResearchTerm', () => {
  it('ranks raw case-insensitive equality as exact', () => {
    expect(matchResearchTerm('COCA-COLA LATA 350ML', 'Coca-Cola Lata 350ml')).toEqual({
      tier: 'exact',
      similarity: 1,
    });
  });

  it('ranks accent/punctuation variants as normalized', () => {
    expect(matchResearchTerm('Guaraná Antarctica 350ml', 'guarana antarctica 350ml')).toEqual({
      tier: 'normalized',
      similarity: 1,
    });
    expect(matchResearchTerm('Coca Cola 350ml', 'Coca-Cola 350ml')).toEqual({
      tier: 'normalized',
      similarity: 1,
    });
  });

  it('matches packaging noise and renames as similar', () => {
    const noise = matchResearchTerm('Coca-Cola Lata 350ml', 'Coca-Cola Original 350ml');
    expect(noise?.tier).toBe('similar');

    const rename = matchResearchTerm(
      'Refrigerante Coca-Cola Lata 350ml',
      'Coca-Cola Original 350ml',
    );
    expect(rename?.tier).toBe('similar');

    const category = matchResearchTerm('Heineken Long Neck 330ml', 'Cerveja Heineken 330ml');
    expect(category?.tier).toBe('similar');
  });

  it('does not cross brands or variants — precision over recall', () => {
    expect(matchResearchTerm('Pepsi Lata 350ml', 'Coca-Cola Lata 350ml')).toBeNull();
    expect(matchResearchTerm('Coca-Cola Zero Lata 350ml', 'Coca-Cola Original 350ml')).toBeNull();
    expect(matchResearchTerm('Suco de Uva 1L', 'Suco de Laranja 1L')).toBeNull();
  });

  it('treats a disagreeing stated volume as a different product', () => {
    expect(matchResearchTerm('Guaraná Antarctica 2L', 'Guaraná Antarctica 350ml')).toBeNull();
  });

  it('never matches nonsense or noise-only terms', () => {
    expect(matchResearchTerm('xyzzy plugh', 'Coca-Cola Original 350ml')).toBeNull();
    expect(matchResearchTerm('Refrigerante Lata', 'Coca-Cola Original 350ml')).toBeNull();
    expect(matchResearchTerm('   ', 'Coca-Cola Original 350ml')).toBeNull();
  });

  it('orders exact before normalized before similar, then by similarity', () => {
    const query = 'Guaraná Antarctica 350ml';
    const exact = matchResearchTerm(query, 'Guaraná Antarctica 350ml')!;
    const normalized = matchResearchTerm(query, 'guarana antarctica 350ml')!;
    const close = matchResearchTerm(query, 'Guarana Antarctica Lata 350ml')!;
    const far = matchResearchTerm(query, 'Guaraná Antarctica Original Lata Gelada 350ml')!;

    const sorted = [far, close, normalized, exact].sort(compareTermMatchRank);
    expect(sorted).toEqual([exact, normalized, close, far]);
  });
});

describe('distinctiveTermTokens', () => {
  it('keeps identity words and drops sizes, counts and packaging noise', () => {
    expect(distinctiveTermTokens('Refrigerante Coca-Cola Lata 350ml fardo 12')).toEqual([
      'coca',
      'cola',
    ]);
    expect(distinctiveTermTokens('Água Mineral 500ml')).toEqual(['mineral']);
    expect(distinctiveTermTokens('Refrigerante Lata')).toEqual([]);
  });
});
