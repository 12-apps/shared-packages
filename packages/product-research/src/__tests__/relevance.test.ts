import { describe, expect, it } from 'vitest';
import { scoreRelevance } from '../scoring/relevance';

describe('scoreRelevance', () => {
  const query = { term: 'Coca-Cola Lata 350ml', brand: 'Coca-Cola' };

  it('scores an exact-product title at or above the 0.95 threshold', () => {
    const score = scoreRelevance(query, { title: 'Refrigerante Coca-Cola Lata 350ml' });
    expect(score).toBeGreaterThanOrEqual(0.95);
  });

  it('zeroes an offer whose stated volume disagrees', () => {
    expect(scoreRelevance(query, { title: 'Coca-Cola Original Pet 2l' })).toBe(0);
    expect(scoreRelevance(query, { title: 'Coca-Cola Lata 350ml' })).toBeGreaterThanOrEqual(0.95);
  });

  it('scores partial matches below threshold', () => {
    const score = scoreRelevance(query, { title: 'Refrigerante Cola genérico' });
    expect(score).toBeLessThan(0.95);
  });

  it('treats an EAN match as identity', () => {
    const score = scoreRelevance(
      { term: 'produto qualquer', ean: '7894900010015' },
      { title: 'oferta sem descrição útil', ean: '7894900010015' },
    );
    expect(score).toBe(1);
  });

  it('uses URL tokens as matching surface', () => {
    const score = scoreRelevance(
      { term: 'Heineken Long Neck 330ml' },
      {
        title: 'Cerveja premium garrafa 330ml',
        url: 'https://loja.example/heineken-long-neck-330ml/p',
      },
    );
    expect(score).toBeGreaterThanOrEqual(0.95);
  });

  it('zeroes when nothing matches', () => {
    expect(scoreRelevance(query, { title: 'Parafuso sextavado inox' })).toBe(0);
  });
});
