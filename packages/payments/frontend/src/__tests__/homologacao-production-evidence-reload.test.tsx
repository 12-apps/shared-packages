// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HomologacaoProductionEvidenceCard,
  type HomologacaoProductionSellerView,
} from '../components/platform/HomologacaoProductionEvidenceCard';
import type { ProductionPixView } from '../components/platform/ProductionPixPanel';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/pt-BR';

/**
 * FUT-5519: the owner reloaded the production evidence card after a run and
 * lost its "Cenários desta cobrança". A reload shows the latest run's outcomes
 * whenever the server has them, settled Pix or not; a card with no run shows
 * no list.
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

const SCENARIOS = [
  { scenario: 'credit', status: 'EXECUTED', reason: null },
  { scenario: 'debit', status: 'FAILED', reason: 'ISSUER_DECLINED' },
  { scenario: 'pix', status: 'EXECUTED', reason: null },
  { scenario: 'googlePay', status: 'FAILED', reason: 'ANTIFRAUD_DECLINED' },
  { scenario: 'applePay', status: 'EXECUTED', reason: null },
] as const;

const REFUNDED = { runId: 'run-1', state: 'REFUNDED', qrText: null, expiresAt: null, refund: null } as unknown as ProductionPixView;

const SELLER: HomologacaoProductionSellerView = {
  connected: true,
  environment: 'PRODUCTION',
  status: 'VERIFIED',
  connectedAt: '2026-10-30T17:02:00Z',
  accountId: 'ACCO_PROD',
  pix: null,
};

function mount(seller: HomologacaoProductionSellerView, overrides: Record<string, unknown> = {}) {
  const props = {
    copy: PT_BR_PLATFORM_HOMOLOGACAO_COPY,
    seller,
    onConnect: vi.fn(async () => undefined),
    onPrepare: vi.fn(async () => ({ runId: 'run-2', publicKey: 'PUBKEY' })),
    onRun: vi.fn(async () => REFUNDED),
    onConfirmPix: vi.fn(async () => REFUNDED),
    onDownload: vi.fn(async () => ({ executed: 20, failed: 2, pending: 2 })),
    pixPollMs: 10,
    ...overrides,
  };
  render(<HomologacaoProductionEvidenceCard {...(props as unknown as Parameters<typeof HomologacaoProductionEvidenceCard>[0])} />);
  return props;
}

const type = (testId: string, value: string): void => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

function charge(): void {
  type('production-buyer-name', 'Comprador Teste');
  type('production-buyer-taxId', '46.556.477/0001-59');
  type('production-buyer-email', 'comprador@example.com');
  type('production-buyer-phone', '(31) 99999-0000');
  type('production-buyer-postalCode', '31610-000');
  type('production-buyer-street', 'Rua Teste');
  type('production-buyer-number', '1');
  type('production-buyer-city', 'Belo Horizonte');
  type('production-buyer-regionCode', 'mg');
  type('production-credit-number', '4111 1111 1111 1111');
  type('production-credit-expiry', '12/30');
  type('production-credit-securityCode', '123');
  fireEvent.click(screen.getByTestId('production-charge'));
  type('production-confirm-input', 'confirmar');
  fireEvent.click(screen.getByTestId('production-confirm-submit'));
}

const text = (key: string): string => (screen.getByTestId(`production-scenario-${key}`).textContent ?? '').replace(/\s+/g, ' ').trim();

describe('a reloaded production evidence card (FUT-5519)', () => {
  it('shows the last run\'s scenarios after its Pix was refunded', async () => {
    mount({ ...SELLER, pix: REFUNDED, scenarios: SCENARIOS });

    await waitFor(() => expect(screen.getByTestId('production-scenario-googlePay')).toBeTruthy());
    expect(text('googlePay')).toContain('o antifraude do PagBank recusou o pagamento');
    expect(text('debit')).toContain('o banco recusou o cartão de débito');
    expect(text('credit')).toContain('executado');
  });

  it('shows the last run\'s scenarios when the server has no Pix view at all', async () => {
    mount({ ...SELLER, pix: null, scenarios: SCENARIOS });

    await waitFor(() => expect(screen.getByTestId('production-scenario-applePay')).toBeTruthy());
  });

  it('shows no list on a card with no run yet', async () => {
    mount({ ...SELLER, pix: null, scenarios: null });

    await screen.findByTestId('production-charge');
    expect(screen.queryAllByTestId('production-scenario-credit')).toHaveLength(0);
  });

  it('drops the earlier run\'s rows once a new charge from this tab fails', async () => {
    const props = mount({ ...SELLER, pix: REFUNDED, scenarios: SCENARIOS }, { onRun: vi.fn(async () => Promise.reject(new Error('lost'))) });
    await waitFor(() => expect(screen.getByTestId('production-scenario-credit')).toBeTruthy());

    charge();

    await waitFor(() => expect(props.onRun).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryAllByTestId('production-scenario-credit')).toHaveLength(0));
  });

  it('shows no list for a run saved before it charged anything', async () => {
    const pending = (['credit', 'debit', 'pix', 'googlePay', 'applePay'] as const).map((scenario) => ({
      scenario,
      status: 'PENDING' as const,
      reason: null,
    }));
    mount({ ...SELLER, pix: null, scenarios: pending });

    await screen.findByTestId('production-charge');
    expect(screen.queryAllByTestId('production-scenario-credit')).toHaveLength(0);
  });
});
