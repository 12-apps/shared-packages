// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductionScenarioList } from '../components/platform/ProductionScenarioList';
import type { ProductionPixView } from '../components/platform/ProductionPixPanel';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/pt-BR';

/**
 * PG1 (FUT-4322 + FUT-4360), the approved prototype option A: each scenario
 * row shows its REAL outcome — ✓ executed (ink), ✗ failed (red) with the
 * reason on the same line, a clock while the Pix refund is retried (amber),
 * ○ pending — and, once PagBank refused the Pix refund 3 of 3 times, the
 * button "Tentar estornar o Pix de novo" under the list.
 *
 * The strings are the prototype's, word for word (contract T1–T9). The rows'
 * marks are images named by their meaning (contract E1–E4), so they are found
 * by role.
 *
 * Props named here (contract, "API"): `scenarios` (the server's outcomes, in
 * place of `sent`), `pix.refund`, `onRetryRefund`, `retrying`.
 */

const SCENARIOS = PT_BR_PLATFORM_HOMOLOGACAO_COPY.productionEvidence.scenarios;
const NOW = new Date('2026-11-11T15:10:00.000Z');

type Outcome = { scenario: 'credit' | 'debit' | 'pix' | 'googlePay' | 'applePay'; status: 'EXECUTED' | 'FAILED' | 'PENDING'; reason: 'EMAIL_EQUALS_MERCHANT' | 'ISSUER_DECLINED' | null };
type Refund = { attempt: number; of: number; nextAt: string | null; exhausted: boolean; refusal: 'NOT_YET' | 'REFUSED' | 'UNKNOWN' | null };

const outcome = (scenario: Outcome['scenario'], status: Outcome['status'], reason: Outcome['reason'] = null): Outcome => ({ scenario, status, reason });

const pixPending = (refund: Refund | null): ProductionPixView =>
  ({ runId: 'run-1', state: 'REFUND_PENDING', qrText: null, expiresAt: null, refund }) as ProductionPixView;

/** The 16:16 run: both cards refused (40002 e-mail), the Pix refund on attempt 2 of 3, the next in 5 min. */
const RUN_1616 = {
  scenarios: [
    outcome('credit', 'FAILED', 'EMAIL_EQUALS_MERCHANT'),
    outcome('debit', 'FAILED', 'EMAIL_EQUALS_MERCHANT'),
    outcome('pix', 'PENDING'),
    outcome('googlePay', 'PENDING'),
    outcome('applePay', 'PENDING'),
  ],
  pix: pixPending({ attempt: 2, of: 3, nextAt: '2026-11-11T15:15:00.000Z', exhausted: false, refusal: 'NOT_YET' }),
};

/** The 16:20 run: credit executed, debit declined by the issuer, the 3 refund attempts refused. */
const RUN_1620 = {
  scenarios: [
    outcome('credit', 'EXECUTED'),
    outcome('debit', 'FAILED', 'ISSUER_DECLINED'),
    outcome('pix', 'FAILED'),
    outcome('googlePay', 'PENDING'),
    outcome('applePay', 'PENDING'),
  ],
  pix: pixPending({ attempt: 3, of: 3, nextAt: null, exhausted: true, refusal: 'NOT_YET' }),
};

function show(run: { scenarios: Outcome[]; pix: ProductionPixView }, extra: { onRetryRefund?: () => void; retrying?: boolean } = {}) {
  const onRetryRefund = extra.onRetryRefund ?? vi.fn();
  const props = { scenarios: run.scenarios, pix: run.pix, checking: true, copy: SCENARIOS, onRetryRefund, retrying: extra.retrying ?? false };
  render(<ProductionScenarioList {...(props as unknown as Parameters<typeof ProductionScenarioList>[0])} />);
  return { onRetryRefund };
}

const row = (key: string): HTMLElement => screen.getByTestId(`production-scenario-${key}`);
const text = (key: string): string => (row(key).textContent ?? '').replace(/\s+/g, ' ').trim();
const mark = (key: string): string | null => within(row(key)).getByRole('img').getAttribute('aria-label');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ProductionScenarioList — prototype option A (PG1)', () => {
  it('R1 given the 16:16 run, then each card row is ✗ "falhou" with the PagBank e-mail reason on the same line', () => {
    show(RUN_1616);

    expect(text('credit')).toBe('Crédito · falhou — o PagBank recusou: o e-mail do comprador não pode ser o da conta do lojista');
    expect(text('debit')).toBe('Débito (3DS) · falhou — o PagBank recusou: o e-mail do comprador não pode ser o da conta do lojista');
    expect(mark('credit')).toBe('falhou');
    expect(mark('debit')).toBe('falhou');
  });

  it('R2 given the Pix refund refused "not yet" on attempt 2 of 3, then the Pix row is the amber clock with the attempt and the countdown', () => {
    show(RUN_1616);

    expect(text('pix')).toBe('Pix · pago — o PagBank ainda não liberou o estorno — tentativa 2 de 3, a próxima em 5 min');
    expect(mark('pix')).toBe('aguardando');
    expect(screen.queryByRole('button', { name: 'Tentar estornar o Pix de novo' })).toBeNull();
  });

  it('R3 given the wallets were not run, then their rows are ○ "pendente" with no reason', () => {
    show(RUN_1616);

    expect(text('googlePay')).toBe('Google Pay · pendente');
    expect(text('applePay')).toBe('Apple Pay · pendente');
    expect(mark('googlePay')).toBe('pendente');
  });

  it('R4 given the 16:20 run, then credit is ✓ "executado" and debit ✗ "falhou — o banco recusou o cartão de débito"', () => {
    show(RUN_1620);

    expect(text('credit')).toBe('Crédito · executado');
    expect(mark('credit')).toBe('executado');
    expect(text('debit')).toBe('Débito (3DS) · falhou — o banco recusou o cartão de débito');
  });

  it('R5 given the 3 refund attempts refused, then the Pix row is ✗ "pago, não estornado" with the hint, and the button sits under the list', () => {
    const { onRetryRefund } = show(RUN_1620);

    expect(text('pix')).toBe(
      'Pix · pago, não estornado — 3 de 3 tentativas recusadas pelo PagBank; tente de novo ou estorne no painel do PagBank',
    );
    expect(mark('pix')).toBe('falhou');
    const button = screen.getByRole('button', { name: 'Tentar estornar o Pix de novo' });
    // Under the list, not inside a row.
    expect(button.closest('li')).toBeNull();
    expect(screen.getByTestId('production-scenarios').contains(button)).toBe(true);

    fireEvent.click(button);
    expect(onRetryRefund).toHaveBeenCalledTimes(1);
  });

  it('R6 given the press is in flight, then the button cannot be pressed again', () => {
    show(RUN_1620, { retrying: true });

    expect((screen.getByRole('button', { name: 'Tentar estornar o Pix de novo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('R7 given the rows, then they keep the order Crédito, Débito (3DS), Pix, Google Pay, Apple Pay and the label "Cenários desta cobrança"', () => {
    show(RUN_1616);

    const list = screen.getByTestId('production-scenarios');
    expect(within(list).getByText('Cenários desta cobrança')).toBeTruthy();
    expect([...list.querySelectorAll('li')].map((li) => li.getAttribute('data-testid'))).toEqual([
      'production-scenario-credit',
      'production-scenario-debit',
      'production-scenario-pix',
      'production-scenario-googlePay',
      'production-scenario-applePay',
    ]);
  });

  it('R8 given the next attempt less than a minute away (or overdue), then the countdown never reads 0 or negative: "a próxima em 1 min"', () => {
    show({ ...RUN_1616, pix: pixPending({ attempt: 1, of: 3, nextAt: '2026-11-11T15:09:30.000Z', exhausted: false, refusal: 'NOT_YET' }) });

    expect(text('pix')).toBe('Pix · pago — o PagBank ainda não liberou o estorno — tentativa 1 de 3, a próxima em 1 min');
  });

  it('R9 given the Pix refunded, then ✓ "pago e estornado" and no button', () => {
    show({ ...RUN_1620, pix: { runId: 'run-1', state: 'REFUNDED', qrText: null, expiresAt: null, refund: null } as ProductionPixView });

    expect(text('pix')).toBe('Pix · pago e estornado');
    expect(mark('pix')).toBe('executado');
    expect(screen.queryByRole('button', { name: 'Tentar estornar o Pix de novo' })).toBeNull();
  });
});
