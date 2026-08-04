// @vitest-environment jsdom
// render from @testing-library/react — plain DOM asserts, no jest-dom.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OffersTable } from '../offers-table';
import { offer } from './fake-client';

/**
 * FUT-497 display-side lock. The live run showed "Refrigerante Coca Cola Zero
 * Açúcar 220ml" at R$ 32,28 as a one-unit price; the pack size lives only in
 * the vendor's listing, so the number itself is all we can qualify. The badge
 * is what makes showing it honest — presence, tooltip, and absence on an
 * ordinary offer are all pinned, plus the price staying on screen: information
 * beats silence, flagged.
 */
const suspect = offer({
  id: 'suspect',
  supplierName: 'Na Sua Casa Por Coca-Cola',
  sourceType: 'SERP',
  title: 'Refrigerante Coca Cola Zero Açúcar 220ml',
  priceCents: 3228,
  packQuantity: 1,
  unitPriceCents: 3228,
  totalCents: 38736,
  rank: 8,
  suspectUnitPrice: true,
});

const can = offer({
  id: 'can',
  supplierName: 'Mercado Mineiro',
  sourceType: 'SERP',
  title: 'Refrigerante Coca Cola Original Lata 220ml',
  priceCents: 290,
  packQuantity: 1,
  unitPriceCents: 290,
  totalCents: 3480,
  rank: 1,
});

describe('OffersTable — suspect unit price (FUT-497)', () => {
  it('badges the implausible unit price and explains the suspicion', () => {
    render(<OffersTable offers={[can, suspect]} />);

    const badge = screen.getByTestId('offer-suspect-unit-suspect');
    expect(badge.textContent).toContain('Preço unitário suspeito');
    // The explanation rides CaveatChip (FUT-495): in the DOM and announced,
    // not a hover-only native `title`.
    expect(badge.textContent).toContain('pacote cuja quantidade não aparece no título');
    // Hedged, because the guard compares prices and not products.
    expect(badge.textContent).toContain('ou um produto de tamanho maior');
    // Never hidden: the flagged price is still readable in the table.
    expect(screen.getByTestId('offers-table').textContent).toContain('R$ 32,28');
  });

  it('leaves a plausible offer unbadged', () => {
    render(<OffersTable offers={[can]} />);

    // Absence asserted on the rendered TEXT: nothing was removed here, so a
    // null-element check would be the flakiness gate's false-negative shape.
    expect(screen.getByTestId('offers-table').textContent).not.toContain(
      'Preço unitário suspeito',
    );
  });

  it('translates the badge through the messages layer', () => {
    render(
      <OffersTable offers={[suspect]} messages={{ suspectUnitPriceBadge: 'Suspect unit price' }} />,
    );

    expect(screen.getByTestId('offer-suspect-unit-suspect').textContent).toContain(
      'Suspect unit price',
    );
  });
});
