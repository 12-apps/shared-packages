import { describe, expect, it } from 'vitest';

import { normalizeSearchText } from '../../src/prisma/search-normalize';

describe('normalizeSearchText (FUT-168)', () => {
  it('strips diacritics and lowercases so "sabao" matches "Sabão"', () => {
    expect(normalizeSearchText('Sabão em Pó 1kg')).toBe('sabao em po 1kg');
    expect(normalizeSearchText('Sabão')).toBe(normalizeSearchText('sabao'));
  });

  it('handles the common Portuguese accents', () => {
    expect(normalizeSearchText('CAFÉ')).toBe('cafe');
    expect(normalizeSearchText('Ação')).toBe('acao');
    expect(normalizeSearchText('Açúcar')).toBe('acucar');
    expect(normalizeSearchText('Ünïcode')).toBe('unicode');
  });

  it('is idempotent on already-normalized text', () => {
    const once = normalizeSearchText('Detergente Neutro');
    expect(normalizeSearchText(once)).toBe(once);
  });

  it('leaves non-letter characters intact', () => {
    expect(normalizeSearchText('Item #3 (500ml)')).toBe('item #3 (500ml)');
  });
});
