// @vitest-environment jsdom
// render/waitFor from @testing-library/react — plain DOM asserts, no jest-dom.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BestOfferCard } from '../best-offer-card';
import { OffersTable } from '../offers-table';
import { offer } from './fake-client';

/**
 * FUT-436 display-side lock: a 6-pack whose pack total is HIGHER than a
 * single unit's price must still show — and be ordered by — its per-unit
 * price. Mirrors the production offer (R$ 22,74 the pack, R$ 3,79 the unit,
 * single can at R$ 4,29): the per-unit cell must render `unitPriceCents`,
 * never `priceCents`, and the row order follows unit price via the rank.
 */
const sixPack = offer({
  id: 'six-pack',
  supplierName: 'Apoio Entrega',
  sourceType: 'VTEX',
  title: 'Refrigerante sem Açúcar Coca-Cola Lata 6 Unidades 350ml Cada Leve Mais Pague Menos',
  priceCents: 2274,
  packQuantity: 6,
  unitPriceCents: 379,
  totalCents: 2274,
  rank: 1,
});

const singleCan = offer({
  id: 'single-can',
  supplierName: 'Apoio Entrega',
  sourceType: 'VTEX',
  title: 'Refrigerante sem Açúcar Coca-Cola Lata 350ml',
  priceCents: 429,
  packQuantity: 1,
  unitPriceCents: 429,
  totalCents: 2574,
  rank: 2,
});

describe('OffersTable — 6-pack unit price (FUT-436)', () => {
  it('renders the per-unit cell from unitPriceCents with the pack math spelled out', () => {
    const { container } = render(<OffersTable offers={[sixPack, singleCan]} />);

    // The unit cell shows total ÷ 6, not the pack total.
    const unitCell = container.querySelector('[title="R$ 22,74 ÷ 6 un = R$ 3,79"]');
    expect(unitCell).not.toBeNull();
    expect(unitCell?.textContent).toBe('R$ 3,79');

    // The pack total still appears — as the total, never as the unit price.
    const text = screen.getByTestId('offers-table').textContent ?? '';
    expect(text).toContain('R$ 3,79');
    expect(text).toContain('R$ 22,74');
  });

  it('orders by unit price: the 6-pack outranks the can despite the higher pack total', () => {
    render(<OffersTable offers={[sixPack, singleCan]} />);

    const text = screen.getByTestId('offers-table').textContent ?? '';
    const sixPackAt = text.indexOf('6 Unidades');
    const canAt = text.indexOf('Coca-Cola Lata 350ml');
    expect(sixPackAt).toBeGreaterThan(-1);
    expect(canAt).toBeGreaterThan(-1);
    expect(sixPackAt).toBeLessThan(canAt);
  });
});

/**
 * FUT-491: a store that does not deliver to the buyer's CEP still shows its
 * default-region prices — flagged. The badge is the entire justification for
 * showing them, so its presence (and its absence on a normal offer) is pinned
 * on both surfaces.
 */
const outOfArea = offer({
  id: 'out-of-area',
  supplierName: 'Apoio Entrega',
  sourceType: 'VTEX',
  title: 'Refrigerante Coca-Cola Lata 350ml',
  priceCents: 379,
  packQuantity: 1,
  unitPriceCents: 379,
  totalCents: 379,
  rank: 1,
  outsideDeliveryArea: true,
});

describe('OffersTable — out-of-area badge (FUT-491)', () => {
  it('badges the flagged offer and explains the caveat in its tooltip', () => {
    render(<OffersTable offers={[outOfArea, singleCan]} />);

    const badge = screen.getByTestId('offer-outside-area-out-of-area');
    expect(badge.textContent).toContain('Fora da área de entrega');
    expect(badge.getAttribute('title')).toContain('região padrão da loja');
    // Flagged, never hidden: the price is still on screen.
    expect(screen.getByTestId('offers-table').textContent).toContain('R$ 3,79');
  });

  /**
   * FUT-495 (FUT-491 review): the caveat used to live ONLY in a native `title`
   * on a wrapper span — never announced by assistive tech, invisible on touch.
   * It is now real text in the accessibility tree on a focusable trigger, on
   * every surface that shows a flagged price.
   */
  it('announces the caveat and is reachable without a pointer', async () => {
    render(<OffersTable offers={[outOfArea, singleCan]} />);

    const badge = screen.getByTestId('offer-outside-area-out-of-area');
    expect(badge.textContent).toContain('Esta loja não entrega no CEP informado');
    await waitFor(() => expect(badge.getAttribute('tabindex')).toBe('0'));
  });

  it('leaves an ordinary offer unbadged', () => {
    render(<OffersTable offers={[singleCan]} />);

    // Absence asserted on the rendered TEXT: nothing was removed here, so a
    // null-element check would be the flakiness gate's false-negative shape.
    expect(screen.getByTestId('offers-table').textContent).not.toContain(
      'Fora da área de entrega',
    );
  });

  it('translates the badge through the messages layer', () => {
    render(<OffersTable offers={[outOfArea]} messages={{ outsideAreaBadge: 'Out of area' }} />);

    expect(screen.getByTestId('offer-outside-area-out-of-area').textContent).toContain(
      'Out of area',
    );
  });
});

/**
 * FUT-519: a run in flight hands the table rows with `rank: null` and no
 * plausibility verdict — both are computed over the WHOLE run, so the API
 * withholds them until it settles. The table needs no special case: it numbers
 * positionally and simply has no badge to draw.
 */
describe('OffersTable — rows from a run still in flight (FUT-519)', () => {
  const partial = [
    offer({ id: 'p1', supplierName: 'Rápida', rank: null }),
    offer({
      id: 'p2',
      supplierName: 'Lenta',
      rank: null,
      priceCents: 3228,
      packQuantity: 1,
      unitPriceCents: 3228,
      totalCents: 3228,
    }),
  ];

  it('numbers unranked rows 1..n in the order the API returned them', () => {
    const { container } = render(<OffersTable offers={partial} />);

    // The "#" column is the second cell (the first is the selection box).
    const numbering = [...container.querySelectorAll('tbody tr')].map(
      (row) => row.querySelectorAll('td')[1]?.textContent,
    );
    expect(numbering).toEqual(['1', '2']);
  });

  it('draws no suspect badge while the API is still withholding the verdict', () => {
    render(<OffersTable offers={partial} />);

    // Absence on the rendered TEXT: nothing was removed here, so a null-element
    // check would be the flakiness gate's false-negative shape.
    expect(screen.getByTestId('offers-table').textContent).not.toContain(
      'Preço unitário suspeito',
    );
  });
});

describe('BestOfferCard — out-of-area badge (FUT-491)', () => {
  it('caveats the hero price when the store does not deliver here', () => {
    render(<BestOfferCard offer={outOfArea} quantity={12} />);

    const badge = screen.getByTestId('best-offer-outside-area');
    expect(badge.textContent).toContain('Fora da área de entrega');
    expect(badge.getAttribute('title')).toContain('não entrega no CEP');
    // The offer still leads — it is the cheapest, and hiding it was the bug.
    expect(screen.getByTestId('best-offer-unit-price').textContent).toContain('R$ 3,79');
  });

  it('announces the hero caveat too, on the same accessible shape', async () => {
    render(<BestOfferCard offer={outOfArea} quantity={12} />);

    const badge = screen.getByTestId('best-offer-outside-area');
    expect(badge.textContent).toContain('Esta loja não entrega no CEP informado');
    await waitFor(() => expect(badge.getAttribute('tabindex')).toBe('0'));
  });

  it('shows no badge for a deliverable offer', () => {
    render(<BestOfferCard offer={singleCan} quantity={6} />);

    expect(screen.getByTestId('best-offer-card').textContent).not.toContain(
      'Fora da área de entrega',
    );
  });
});

/**
 * FUT-518: `shippingCents` is a TRI-STATE on the wire — null = the source never
 * stated a shipping cost (so the total is a MINIMUM), 0 = it stated free. The
 * ranking still floors an unknown at 0 rather than inventing an estimate, which
 * makes this badge the entire justification for showing that total next to
 * totals that are final. Presence, absence on a stated-free row, and the price
 * staying on screen are all pinned.
 */
const shippingUnknown = offer({
  id: 'shipping-unknown',
  supplierName: 'Mercado Preço Bom',
  sourceType: 'SERP',
  title: 'Coca Cola lata 350',
  priceCents: 449,
  packQuantity: 1,
  unitPriceCents: 449,
  totalCents: 5388,
  rank: 1,
  shippingCents: null,
});

describe('OffersTable — unknown shipping badge (FUT-518)', () => {
  it('badges the total whose freight the source never stated', () => {
    render(<OffersTable offers={[shippingUnknown, singleCan]} />);

    const badge = screen.getByTestId('offer-shipping-unknown-shipping-unknown');
    expect(badge.textContent).toContain('Frete não informado');
    // The caveat says the total is a minimum and where to confirm it — hedged,
    // because a store with free delivery that simply did not say so is also here.
    expect(badge.textContent).toContain('o frete pode somar');
    // Flagged, never hidden: the total is still readable in the table.
    expect(screen.getByTestId('offers-table').textContent).toContain('R$ 53,88');
  });

  it('announces the caveat and is reachable without a pointer', async () => {
    render(<OffersTable offers={[shippingUnknown]} />);

    const badge = screen.getByTestId('offer-shipping-unknown-shipping-unknown');
    expect(badge.textContent).toContain('não informou o valor do frete');
    await waitFor(() => expect(badge.getAttribute('tabindex')).toBe('0'));
  });

  it('leaves a STATED free-shipping row unbadged — 0 is an answer', () => {
    // `singleCan` carries shippingCents 0, which means the source SAID free.
    // Badging it would re-create the conflation this ticket removed, inverted.
    render(<OffersTable offers={[singleCan]} />);

    // Absence asserted on the rendered TEXT: nothing was removed here, so a
    // null-element check would be the flakiness gate's false-negative shape.
    expect(screen.getByTestId('offers-table').textContent).not.toContain('Frete não informado');
  });

  it('translates the badge through the messages layer', () => {
    render(
      <OffersTable offers={[shippingUnknown]} messages={{ shippingUnknownBadge: 'Shipping unknown' }} />,
    );

    expect(screen.getByTestId('offer-shipping-unknown-shipping-unknown').textContent).toContain(
      'Shipping unknown',
    );
  });
});

describe('BestOfferCard — unknown shipping badge (FUT-518)', () => {
  it('caveats the hero total when the store never stated a freight cost', () => {
    render(<BestOfferCard offer={shippingUnknown} quantity={12} />);

    const badge = screen.getByTestId('best-offer-shipping-unknown');
    expect(badge.textContent).toContain('Frete não informado');
    expect(badge.getAttribute('title')).toContain('não informou o valor do frete');
    // The offer still leads on the ranking's arithmetic — the caveat travels
    // with the number rather than demoting the row.
    expect(screen.getByTestId('best-offer-total').textContent).toContain('R$ 53,88');
  });

  it('shows no badge when the store stated free shipping', () => {
    render(<BestOfferCard offer={singleCan} quantity={6} />);

    expect(screen.getByTestId('best-offer-card').textContent).not.toContain('Frete não informado');
  });
});

describe('BestOfferCard — 6-pack unit price (FUT-436)', () => {
  it('shows R$ 3,79 as the headline unit price and the pack total only in the math', () => {
    render(<BestOfferCard offer={sixPack} quantity={6} />);

    expect(screen.getByTestId('best-offer-unit-price').textContent).toContain('R$ 3,79');
    expect(screen.getByTestId('best-offer-total').textContent).toContain('R$ 22,74');
    // Fardo math spelled out: total ÷ units = unit.
    expect(screen.getByTestId('best-offer-card').textContent).toContain(
      'R$ 22,74 ÷ 6 un = R$ 3,79',
    );
  });
});
