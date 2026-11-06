// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PT_BR_TENDER_SPLIT_COPY } from '../pt-BR';
import { TenderSplit } from '../tender-split';
import type { TenderOption } from '../tender-card';

/**
 * FUT-4416, C30 / E44 — each tender card says what the bill comes to if paid
 * that way, and the bar and the confirm follow the tenders tapped, pro rata.
 */
type Tender = 'CASH' | 'CREDIT' | 'PIX';

const PRICED: TenderOption<Tender>[] = [
  { id: 'CASH', label: 'Dinheiro', icon: null, givesChange: true, priceCents: 8216 },
  { id: 'CREDIT', label: 'Crédito', icon: null, givesChange: false, priceCents: 8470 },
  { id: 'PIX', label: 'Pix', icon: null, givesChange: false, priceCents: 7520 },
];
const PLAIN: TenderOption<Tender>[] = PRICED.map((tender) => ({ ...tender, priceCents: undefined }));

function renderSplit(tenders: TenderOption<Tender>[]) {
  const onConfirm = vi.fn();
  render(<TenderSplit tenders={tenders} totalCents={8470} copy={PT_BR_TENDER_SPLIT_COPY} locale="pt-BR" currency="BRL" onConfirm={onConfirm} />);
  return onConfirm;
}

/** Intl puts a no-break space after "R$"; compare on plain spaces. */
const text = (testId: string): string => (screen.getByTestId(testId).textContent ?? '').replace(/\u00a0/gu, ' ');

afterEach(cleanup);

describe('a tender card with a price', () => {
  it('says what the bill comes to if paid that way', () => {
    renderSplit(PRICED);
    expect(text('tender-split-option-PIX-price')).toBe('R$ 75,20');
    expect(text('tender-split-option-CASH-price')).toBe('R$ 82,16');
    expect(text('tender-split-option-PIX')).toContain('Pix');
  });

  it('one tender tapped: the confirm names its price, and the host gets the priced total', () => {
    const onConfirm = renderSplit(PRICED);
    fireEvent.click(screen.getByTestId('tender-split-option-PIX'));
    expect(text('tender-split-confirm')).toBe('Confirmar R$ 75,20');
    fireEvent.click(screen.getByTestId('tender-split-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ legs: [{ tender: 'PIX' }], changeCents: 0, dueCents: 7520 });
  });

  it('two tapped: each share at its own price, the bar recording their sum', () => {
    renderSplit(PRICED);
    fireEvent.click(screen.getByTestId('tender-split-option-PIX'));
    fireEvent.click(screen.getByTestId('tender-split-option-CASH'));
    expect((screen.getByTestId('tender-split-picked-PIX-amount') as HTMLInputElement).value).toBe('37,60');
    expect((screen.getByTestId('tender-split-picked-CASH-amount') as HTMLInputElement).value).toBe('41,08');
    expect(text('tender-split-launched')).toBe('Lançado R$ 78,68');
    expect(text('tender-split-confirm')).toBe('Confirmar R$ 78,68');
  });
});

describe('tender cards with no price', () => {
  it('draw no price line, and the confirm names the bill, as today', async () => {
    const onConfirm = renderSplit(PLAIN);
    await waitFor(() => expect(screen.queryByTestId('tender-split-option-PIX-price')).toBeNull());
    fireEvent.click(screen.getByTestId('tender-split-option-PIX'));
    expect(text('tender-split-confirm')).toBe('Confirmar R$ 84,70');
    fireEvent.click(screen.getByTestId('tender-split-confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ legs: [{ tender: 'PIX' }], changeCents: 0 });
  });
});
