// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PT_BR_TENDER_SPLIT_COPY } from '../pt-BR';
import { TenderSplit } from '../tender-split';
import type { TenderOption } from '../tender-card';

/**
 * The panel an operator answers "how was it paid?" on: what the bar and the
 * confirm say, and what reaches the host when it is pressed.
 */
type Tender = 'CASH' | 'CREDIT' | 'DEBIT';

const TENDERS: TenderOption<Tender>[] = [
  { id: 'CASH', label: 'Dinheiro', givesChange: true },
  { id: 'CREDIT', label: 'Cartão de crédito' },
  { id: 'DEBIT', label: 'Cartão de débito' },
];

function renderSplit(onCancel?: () => void) {
  const onConfirm = vi.fn();
  render(
    <TenderSplit
      tenders={TENDERS}
      totalCents={44440}
      copy={PT_BR_TENDER_SPLIT_COPY}
      locale="pt-BR"
      currency="BRL"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return onConfirm;
}

const amountOf = (tender: Tender): HTMLInputElement =>
  screen.getByTestId(`tender-split-picked-${tender}-amount`);
const confirm = (): HTMLElement => screen.getByTestId('tender-split-confirm');
/** Intl puts a no-break space after "R$"; compare on plain spaces. */
const text = (element: HTMLElement): string => (element.textContent ?? '').replace(/\s/gu, ' ');

afterEach(cleanup);

describe('TenderSplit', () => {
  it('asks for a tender before anything can be confirmed', () => {
    renderSplit();
    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
    expect(text(confirm())).toBe('Escolha a forma');
    expect(text(screen.getByTestId('tender-split-rest'))).toBe('Falta R$ 444,40');
  });

  it('gives one tapped tender the whole bill and confirms it as the rest', () => {
    const onConfirm = renderSplit();
    fireEvent.click(screen.getByTestId('tender-split-option-CASH'));

    expect(amountOf('CASH').value).toBe('444,40');
    expect(text(screen.getByTestId('tender-split-rest'))).toBe('Fechou');
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith({ legs: [{ tender: 'CASH' }], changeCents: 0 });
  });

  it('splits equally as tenders are tapped', () => {
    renderSplit();
    fireEvent.click(screen.getByTestId('tender-split-option-CASH'));
    fireEvent.click(screen.getByTestId('tender-split-option-CREDIT'));
    fireEvent.click(screen.getByTestId('tender-split-option-DEBIT'));

    expect([amountOf('CASH'), amountOf('CREDIT'), amountOf('DEBIT')].map((i) => i.value)).toEqual([
      '148,13',
      '148,13',
      '148,14',
    ]);
  });

  it('keeps a typed amount and shares the rest among the tapped ones', () => {
    const onConfirm = renderSplit();
    fireEvent.click(screen.getByTestId('tender-split-option-CASH'));
    fireEvent.click(screen.getByTestId('tender-split-option-CREDIT'));
    fireEvent.change(amountOf('CASH'), { target: { value: '200' } });

    expect(amountOf('CREDIT').value).toBe('244,40');
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith({
      legs: [{ tender: 'CASH', amountCents: 20000 }, { tender: 'CREDIT' }],
      changeCents: 0,
    });
  });

  it('names what is missing on the confirm instead of only disabling it', () => {
    renderSplit();
    fireEvent.click(screen.getByTestId('tender-split-option-CREDIT'));
    fireEvent.change(amountOf('CREDIT'), { target: { value: '400' } });

    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
    expect(text(confirm())).toBe('Falta R$ 44,40');
  });

  it('shows the change when cash received passes the bill', () => {
    const onConfirm = renderSplit();
    fireEvent.click(screen.getByTestId('tender-split-option-CASH'));
    fireEvent.change(amountOf('CASH'), { target: { value: '500' } });

    expect(text(screen.getByTestId('tender-split-change'))).toContain('R$ 55,60');
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith({
      legs: [{ tender: 'CASH', amountCents: 44440 }],
      changeCents: 5560,
    });
  });

  it('frees a typed amount only when its card is removed', () => {
    renderSplit();
    fireEvent.click(screen.getByTestId('tender-split-option-CASH'));
    fireEvent.click(screen.getByTestId('tender-split-option-CREDIT'));
    fireEvent.change(amountOf('CASH'), { target: { value: '200' } });
    fireEvent.click(screen.getByTestId('tender-split-picked-CASH-remove'));

    expect(amountOf('CREDIT').value).toBe('444,40');
    fireEvent.click(screen.getByTestId('tender-split-option-CASH'));
    expect(amountOf('CASH').value).toBe('222,20');
  });

  it('renders a cancel only for a host that handles it', () => {
    const onCancel = vi.fn();
    renderSplit(onCancel);
    fireEvent.click(screen.getByTestId('tender-split-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
