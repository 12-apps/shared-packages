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
 * FUT-5519, the owner's option B: each step of a production run shows its own
 * result, while the run goes and after it ends. A step that failed never
 * reads as done (the owner: "começou falando que estava tudo verde").
 */

const SELLER: HomologacaoProductionSellerView = {
  connected: true,
  environment: 'PRODUCTION',
  status: 'VERIFIED',
  connectedAt: '2026-10-30T17:02:00Z',
  accountId: 'ACCO_PROD',
  pix: null,
};

const REFUNDED = { runId: 'run-1', state: 'REFUNDED', qrText: null, expiresAt: null, refund: null } as unknown as ProductionPixView;

const DONE_BEFORE_WALLETS = [
  { scenario: 'pix', status: 'EXECUTED', reason: null },
  { scenario: 'credit', status: 'PENDING', reason: null },
  { scenario: 'debit', status: 'PENDING', reason: null },
] as const;

const ALL = [
  ...DONE_BEFORE_WALLETS,
  { scenario: 'googlePay', status: 'FAILED', reason: 'ANTIFRAUD_DECLINED' },
  { scenario: 'applePay', status: 'EXECUTED', reason: null },
] as const;

beforeEach(() => {
  window.localStorage.clear();
  // The SDK answers but cannot encrypt the card: the browser's own failure, NOT_PROCESSED.
  (window as { PagSeguro?: unknown }).PagSeguro = { encryptCard: vi.fn(() => ({ hasErrors: true, errors: [] })) };
});

afterEach(() => {
  cleanup();
  delete (window as { PagSeguro?: unknown }).PagSeguro;
});

type Release = () => void;

function mount(onRun: (...args: never[]) => Promise<unknown>) {
  const props = {
    copy: PT_BR_PLATFORM_HOMOLOGACAO_COPY,
    seller: SELLER,
    onConnect: vi.fn(async () => undefined),
    onPrepare: vi.fn(async () => ({ runId: 'run-1', publicKey: 'PUBKEY' })),
    onRun: vi.fn(onRun),
    onConfirmPix: vi.fn(async () => REFUNDED),
    onDownload: vi.fn(async () => ({ executed: 20, failed: 2, pending: 2 })),
    pixPollMs: 10,
  };
  render(<HomologacaoProductionEvidenceCard {...(props as unknown as Parameters<typeof HomologacaoProductionEvidenceCard>[0])} />);
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

const step = (key: string): HTMLElement => screen.getByTestId(`evidence-step-${key}`);
const words = (key: string): string => (step(key).textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the production run marks each step with its own result (FUT-5519, option B)', () => {
  it('shows, while the run goes, each finished section with its result and the card the browser could not prepare', async () => {
    const gate: { release?: Release } = {};
    mount(async (_runId: never, _cards: never, _wallets: never, onSection: (s: string, d?: unknown) => void) => {
      onSection('PIX', []);
      onSection('APPLE_PAY', [...DONE_BEFORE_WALLETS, ALL[3]]);
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
      return { pix: REFUNDED, scenarios: ALL };
    });

    charge();

    await waitFor(() => expect(step('APPLE_PAY').getAttribute('data-state')).toBe('current'));
    expect(step('GOOGLE_PAY').getAttribute('data-state')).toBe('failed');
    expect(words('GOOGLE_PAY')).toContain('falhou — o antifraude do PagBank recusou o pagamento');
    expect(step('PIX').getAttribute('data-state')).toBe('done');
    expect(step('CARD').getAttribute('data-state')).toBe('notRun');
    expect(words('encrypt')).toContain('pendente — o SDK do PagBank não criptografou o cartão');
    gate.release?.();
  });

  it('keeps the steps on screen once the run is over, each with the run answer\'s result', async () => {
    mount(async () => ({ pix: REFUNDED, scenarios: ALL }));

    charge();

    await waitFor(() => expect(step('APPLE_PAY').getAttribute('data-state')).toBe('done'));
    expect(step('GOOGLE_PAY').getAttribute('data-state')).toBe('failed');
    expect(step('DEBIT').getAttribute('data-state')).toBe('notRun');
    expect(step('file').getAttribute('data-state')).toBe('done');
    expect(screen.getByTestId('evidence-phase').getAttribute('aria-busy')).toBe('false');
  });
});
