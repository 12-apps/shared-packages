import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ShareBar } from '../ShareBar';
import { fitsInline, shareBarParts } from '../share-bar-model';

const PAYMENTS = [
  { key: 'pix', label: 'Pix', value: 1 },
  { key: 'card', label: 'Cartão', value: 1 },
  { key: 'cash', label: 'Dinheiro', value: 1 },
];

describe('shareBarParts (FUT-145)', () => {
  it('rounds to whole percents that add to exactly 100', () => {
    const parts = shareBarParts(PAYMENTS);
    expect(parts.map((part) => part.percent)).toEqual([34, 33, 33]);
    expect(parts.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1);
  });

  it('gives a part at or under zero no share, and an empty whole no percents', () => {
    expect(shareBarParts([{ key: 'a', label: 'A', value: 3 }, { key: 'b', label: 'B', value: -2 }]).map((p) => p.percent)).toEqual([100, 0]);
    expect(shareBarParts([{ key: 'a', label: 'A', value: 0 }]).map((p) => [p.share, p.percent])).toEqual([[0, 0]]);
  });

  it('keeps a part too thin to label inside the bar out of it', () => {
    expect(fitsInline(10, '3%', 12, 4)).toBe(false);
    expect(fitsInline(80, '100%', 12, 4)).toBe(true);
  });
});

describe('ShareBar (FUT-145)', () => {
  const segments = [
    { key: 'pix', label: 'Pix', value: 4500 },
    { key: 'card', label: 'Cartão', value: 3500 },
    { key: 'cash', label: 'Dinheiro', value: 2000 },
    { key: 'voucher', label: 'Vale', value: 0 },
  ];

  it('lists every part in order, with its percent and figure, as a named list', () => {
    render(
      <ShareBar
        segments={segments}
        label="Vendas por forma de pagamento"
        formatValue={(value) => `R$ ${value}`}
        dataTestId="pay"
      />,
    );
    const list = screen.getByRole('list', { name: 'Vendas por forma de pagamento' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Pix45%R$ 4500',
      'Cartão35%R$ 3500',
      'Dinheiro20%R$ 2000',
      'Vale0%R$ 0',
    ]);
  });

  it('draws one segment per part with a share, sized by it, and hides the bar from assistive tech', () => {
    render(<ShareBar segments={segments} label="Vendas" dataTestId="pay" />);
    expect(screen.getByTestId('pay-bar')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('pay-segment-pix')).toHaveAttribute('data-share', '0.4500');
    expect(screen.queryAllByTestId('pay-segment-voucher')).toHaveLength(0);
  });

  it('takes the host percent format', () => {
    render(<ShareBar segments={segments} label="Vendas" formatPercent={(p) => `${p} %`} dataTestId="pay" />);
    expect(within(screen.getByTestId('pay-item-pix')).getByText('45 %')).toBeInTheDocument();
  });
});
