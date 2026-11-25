// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HomologacaoProductionEvidenceCard,
  type HomologacaoProductionSellerView,
} from '../components/platform/HomologacaoProductionEvidenceCard';
import type { ProductionPixView } from '../components/platform/ProductionPixPanel';
import { retryPlanOf } from '../components/platform/production-retry';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/pt-BR';

/**
 * FUT-5584, the owner: "Se falhar só uma coisa, quero poder tentar só aquela
 * coisa ... quero conseguir retentar só o que nao passou". Once the latest run
 * left a scenario that did not pass, the card offers one press that raises
 * only it again, in the same run; a debit-only retry needs no credit card, and
 * nothing that passed is charged again.
 */

beforeEach(() => {
  window.localStorage.clear();
  (window as { PagSeguro?: unknown }).PagSeguro = {
    encryptCard: vi.fn((params: { number: string }) => ({ hasErrors: false, encryptedCard: `enc-${params.number.slice(-4)}` })),
  };
});

afterEach(() => {
  cleanup();
  delete (window as { PagSeguro?: unknown }).PagSeguro;
});

const COPY = PT_BR_PLATFORM_HOMOLOGACAO_COPY.productionEvidence;

const REFUNDED = { runId: 'run-1', state: 'REFUNDED', qrText: null, expiresAt: null, refund: null } as unknown as ProductionPixView;

const SELLER: HomologacaoProductionSellerView = {
  connected: true,
  environment: 'PRODUCTION',
  status: 'VERIFIED',
  connectedAt: '2026-11-24T17:02:00Z',
  accountId: 'ACCO_PROD',
  pix: REFUNDED,
  lastRunId: 'run-1',
  lastRunAt: '2026-11-24T23:48:00Z',
  scenarios: [
    { scenario: 'credit', status: 'EXECUTED', reason: null },
    { scenario: 'debit', status: 'FAILED', reason: 'ISSUER_DECLINED' },
    { scenario: 'pix', status: 'EXECUTED', reason: null },
    { scenario: 'googlePay', status: 'EXECUTED', reason: null },
    { scenario: 'applePay', status: 'EXECUTED', reason: null },
  ],
  retryable: ['DEBIT'],
};

function mount(seller: HomologacaoProductionSellerView) {
  const props = {
    copy: PT_BR_PLATFORM_HOMOLOGACAO_COPY,
    seller,
    onConnect: vi.fn(async () => undefined),
    onPrepare: vi.fn(async () => ({ runId: 'run-2', publicKey: 'PUBKEY' })),
    onPrepareRetry: vi.fn(async (runId: string) => ({ runId, publicKey: 'PUBKEY' })),
    onRun: vi.fn(async () => REFUNDED),
    onChargeNow: vi.fn(async () => ({ paid: {}, outcomes: [] })),
    onConfirmPix: vi.fn(async () => REFUNDED),
    onDownload: vi.fn(async () => ({ executed: 20, failed: 0, pending: 0 })),
    pixPollMs: 60_000,
  };
  type CardProps = Parameters<typeof HomologacaoProductionEvidenceCard>[0];
  render(<HomologacaoProductionEvidenceCard {...(props as unknown as CardProps)} />);
  return props;
}

const type = (testId: string, value: string): void => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

function fillBuyer(): void {
  type('production-buyer-name', 'Comprador Teste');
  type('production-buyer-taxId', '46.556.477/0001-59');
  type('production-buyer-email', 'comprador@example.com');
  type('production-buyer-phone', '(31) 99999-0000');
  type('production-buyer-postalCode', '31610-000');
  type('production-buyer-street', 'Rua Teste');
  type('production-buyer-number', '1');
  type('production-buyer-city', 'Belo Horizonte');
  type('production-buyer-regionCode', 'mg');
}

function fillDebit(): void {
  type('production-debit-number', '5555 6666 7777 8884');
  type('production-debit-expiry', '01/31');
  type('production-debit-securityCode', '321');
}

describe('retry only what failed (FUT-5584)', () => {
  it('given the debit failed and no debit card typed, then the card says what the retry still needs', () => {
    mount(SELLER);

    expect(screen.getByTestId('production-retry-waiting').textContent).toContain(COPY.retry.needs.DEBIT);
    expect(screen.getByTestId('production-retry').textContent).not.toContain(COPY.retry.button('Débito (3DS)'));
  });

  it('given the debit card typed and no credit card, then one press retries only the debit in the same run', async () => {
    const props = mount(SELLER);
    fillBuyer();
    fillDebit();

    const button = screen.getByTestId('production-retry-failed');
    expect(button.textContent).toBe(COPY.retry.button('Débito (3DS)'));
    fireEvent.click(button);
    type('production-confirm-input', 'confirmar');
    fireEvent.click(screen.getByTestId('production-confirm-submit'));

    await waitFor(() => expect(props.onRun).toHaveBeenCalledTimes(1));
    expect(props.onPrepare).not.toHaveBeenCalled();
    expect(props.onPrepareRetry).toHaveBeenCalledWith('run-1', expect.objectContaining({ name: 'Comprador Teste' }));
    // Nothing that passed is fired again: no Pix, no wallet, no credit card.
    expect(props.onChargeNow).not.toHaveBeenCalled();
    const [runId, cards, wallets, , , sections, options] = props.onRun.mock.calls[0] as unknown as [
      string,
      { scenario: string }[],
      unknown[],
      unknown,
      unknown,
      string[],
      { retry?: boolean },
    ];
    expect(runId).toBe('run-1');
    expect(cards.map((card) => card.scenario)).toEqual(['debit']);
    expect(wallets).toEqual([]);
    expect(sections).toEqual(['DEBIT']);
    expect(options).toEqual({ retry: true });
  });

  it('given every scenario passed, then no retry is offered', () => {
    mount({ ...SELLER, retryable: [] });

    // The list is drawn (the run is on screen), and it offers no retry.
    expect(screen.getByTestId('production-scenario-debit').textContent).toContain('Débito');
    expect(screen.getByTestId('homologacao-production-evidence-card').textContent).not.toContain(COPY.retry.button('').trim());
  });

  it('given what the screen holds, then the plan splits the sections it can retry now from those still waiting', () => {
    const inputs = { credit: false, debit: true, googlePay: false, applePay: true };

    expect(retryPlanOf(['APPLE_PAY', 'PIX', 'CARD', 'DEBIT', 'GOOGLE_PAY'], inputs)).toEqual({
      now: ['PIX', 'DEBIT', 'APPLE_PAY'],
      waiting: ['CARD', 'GOOGLE_PAY'],
    });
    expect(retryPlanOf(null, inputs)).toEqual({ now: [], waiting: [] });
  });
});
