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
 * PG1 at the card (FUT-4322 + FUT-4360): the outcomes come from the SERVER —
 * `onRun` answers the run's Pix AND its scenario outcomes, and a reloaded
 * screen reads them from the seller view — and the exhausted refund's button
 * asks the server with the new `RETRY_REFUND` action. The CHECK poll no longer
 * moves money: it only reads where the refund stands.
 */

const COPY = PT_BR_PLATFORM_HOMOLOGACAO_COPY;

const SCENARIOS = [
  { scenario: 'credit', status: 'FAILED', reason: 'EMAIL_EQUALS_MERCHANT' },
  { scenario: 'debit', status: 'FAILED', reason: 'ISSUER_DECLINED' },
  { scenario: 'pix', status: 'PENDING', reason: null },
  { scenario: 'googlePay', status: 'PENDING', reason: null },
  { scenario: 'applePay', status: 'PENDING', reason: null },
];

const EXHAUSTED = {
  runId: 'run-1',
  state: 'REFUND_PENDING',
  qrText: null,
  expiresAt: null,
  refund: { attempt: 3, of: 3, nextAt: null, exhausted: true, refusal: 'NOT_YET' },
} as unknown as ProductionPixView;

const RETRYING = {
  ...EXHAUSTED,
  refund: { attempt: 1, of: 3, nextAt: '2026-11-11T15:15:00.000Z', exhausted: false, refusal: 'NOT_YET' },
} as unknown as ProductionPixView;

const SELLER: HomologacaoProductionSellerView = {
  connected: true,
  environment: 'PRODUCTION',
  status: 'VERIFIED',
  connectedAt: '2026-10-30T17:02:00Z',
  accountId: 'ACCO_PROD',
  pix: null,
};

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

function mount(overrides: Record<string, unknown> = {}) {
  const props = {
    copy: COPY,
    seller: SELLER,
    onConnect: vi.fn(async () => undefined),
    onPrepare: vi.fn(async () => ({ runId: 'run-1', publicKey: 'PUBKEY' })),
    onRun: vi.fn(async () => ({ pix: EXHAUSTED, scenarios: SCENARIOS })),
    onConfirmPix: vi.fn(async (_runId: string, action: string) => (action === 'RETRY_REFUND' ? RETRYING : EXHAUSTED)),
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
  type('production-buyer-name', 'Thompson Moreira Filgueiras');
  type('production-buyer-taxId', '46.556.477/0001-59');
  type('production-buyer-email', 'thom@paladira.com');
  type('production-buyer-phone', '(31) 99449-4408');
  type('production-buyer-postalCode', '31610-000');
  type('production-buyer-street', 'Rua Padre Pedro Pinto');
  type('production-buyer-number', '424');
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

describe('the production evidence card shows the server’s outcomes (PG1)', () => {
  it('C1 given the run answered its outcomes, then the rows show them — never "registrado no arquivo"', async () => {
    mount();
    charge();

    await waitFor(() => expect(screen.getByTestId('production-scenario-credit')).toBeTruthy());
    expect(text('credit')).toBe('Crédito · falhou — o PagBank recusou: o e-mail do comprador não pode ser o da conta do lojista');
    expect(text('debit')).toBe('Débito (3DS) · falhou — o banco recusou o cartão de débito');
    expect(screen.getByTestId('production-scenarios').textContent).not.toContain('registrado no arquivo');
  });

  it('C2 given the refund attempts ran out, when "Tentar estornar o Pix de novo" is pressed, then the host is asked RETRY_REFUND once and the row shows attempt 1 again', async () => {
    const props = mount();
    charge();

    const button = await screen.findByRole('button', { name: 'Tentar estornar o Pix de novo' });
    fireEvent.click(button);

    await waitFor(() => expect(props.onConfirmPix).toHaveBeenCalledWith('run-1', 'RETRY_REFUND'));
    expect(props.onConfirmPix.mock.calls.filter(([, action]) => action === 'RETRY_REFUND')).toHaveLength(1);
    await waitFor(() => expect(text('pix')).toContain('tentativa 1 de 3'));
  });

  it('C3 given a reload, then the outcomes come back from the seller view', async () => {
    mount({ seller: { ...SELLER, pix: EXHAUSTED, scenarios: SCENARIOS } });

    await waitFor(() => expect(screen.getByTestId('production-scenario-credit')).toBeTruthy());
    expect(text('credit')).toContain('falhou');
    expect(screen.getByRole('button', { name: 'Tentar estornar o Pix de novo' })).toBeTruthy();
  });

  it('C4 given the attempts ran out, then the Pix panel no longer says "Estornando o R$ 1,00…": the row says what happened', async () => {
    mount();
    charge();

    await screen.findByRole('button', { name: 'Tentar estornar o Pix de novo' });
    expect(screen.queryByTestId('production-pix-refunding')).toBeNull();
  });
});
