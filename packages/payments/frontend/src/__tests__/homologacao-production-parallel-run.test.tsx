// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserWalletResult } from '@12-apps/payments-backend';

import {
  HomologacaoProductionEvidenceCard,
  type HomologacaoProductionSellerView,
} from '../components/platform/HomologacaoProductionEvidenceCard';
import type { ProductionPixView } from '../components/platform/ProductionPixPanel';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/pt-BR';

/**
 * FUT-5519, the owner: "tudo em paralelo"; "google pay, pix e apple pay nao
 * precisa esperar criptografar, dispara imediato". With the host's
 * `onChargeNow`, the Pix goes out as soon as the run is prepared, before the
 * cards are encrypted; Apple Pay as soon as its sheet authorizes; phase 2
 * raises only the cards.
 */

const SELLER: HomologacaoProductionSellerView = {
  connected: true,
  environment: 'PRODUCTION',
  status: 'VERIFIED',
  connectedAt: '2026-10-30T17:02:00Z',
  accountId: 'ACCO_PROD',
  pix: null,
  wallets: { amountCents: 100, googlePay: null, applePay: { configured: true } },
} as unknown as HomologacaoProductionSellerView;

const REFUNDED = { runId: 'run-1', state: 'REFUNDED', qrText: null, expiresAt: null, refund: null } as unknown as ProductionPixView;

interface Sheet {
  begun: boolean;
  completions: { status: number }[];
  authorize: () => void;
  cancel: () => void;
}

/** Safari's ApplePaySession, faked: each session the card starts, and its handlers. */
function installApplePay(): Sheet[] {
  const sheets: Sheet[] = [];
  class Session {
    static STATUS_SUCCESS = 0;
    static STATUS_FAILURE = 1;
    static canMakePayments(): boolean {
      return true;
    }
    onvalidatemerchant: ((event: { validationURL: string }) => void) | null = null;
    onpaymentauthorized: ((event: unknown) => void) | null = null;
    oncancel: (() => void) | null = null;
    constructor() {
      const sheet: Sheet = {
        begun: false,
        completions: [],
        authorize: () =>
          this.onpaymentauthorized?.({
            payment: { token: { paymentData: { data: 'apay-secret' }, paymentMethod: { network: 'Visa', displayName: 'Visa 4242' } } },
          }),
        cancel: () => this.oncancel?.(),
      };
      this.sheet = sheet;
      sheets.push(sheet);
    }
    sheet: Sheet;
    begin(): void {
      this.sheet.begun = true;
    }
    abort(): void {}
    completeMerchantValidation(): void {}
    completePayment(result: { status: number }): void {
      this.sheet.completions.push(result);
    }
  }
  (window as { ApplePaySession?: unknown }).ApplePaySession = Session;
  return sheets;
}

beforeEach(() => {
  window.localStorage.clear();
  (window as { PagSeguro?: unknown }).PagSeguro = { encryptCard: vi.fn(() => ({ hasErrors: true, errors: [] })) };
});

afterEach(() => {
  cleanup();
  delete (window as { PagSeguro?: unknown }).PagSeguro;
  delete (window as { ApplePaySession?: unknown }).ApplePaySession;
});

const OUTCOME = (scenario: string) => ({ scenario, status: 'EXECUTED', reason: null });

function mount(order: string[]) {
  const props = {
    copy: PT_BR_PLATFORM_HOMOLOGACAO_COPY,
    seller: SELLER,
    onConnect: vi.fn(async () => undefined),
    onPrepare: vi.fn(async () => ({ runId: 'run-1', publicKey: 'PUBKEY' })),
    onChargeNow: vi.fn(async (_runId: string, input: { pix: boolean; wallets: BrowserWalletResult[] }) => {
      order.push(input.pix ? 'now:pix' : `now:${input.wallets.map((wallet) => wallet.type).join(',')}`);
      return {
        paid: Object.fromEntries(input.wallets.map((wallet) => [wallet.type, true])),
        outcomes: [...(input.pix ? [OUTCOME('pix')] : []), ...input.wallets.map(() => OUTCOME('applePay'))],
      };
    }),
    onRun: vi.fn(async () => {
      order.push('run');
      return { pix: REFUNDED, scenarios: null };
    }),
    onConfirmPix: vi.fn(async () => REFUNDED),
    onDownload: vi.fn(async () => ({ executed: 20, failed: 0, pending: 0 })),
    onValidateApplePayMerchant: vi.fn(async () => ({ merchantSessionIdentifier: 'ms-1' })),
    loadApplePaySdk: async () => null,
    pixPollMs: 10,
  };
  render(<HomologacaoProductionEvidenceCard {...(props as unknown as Parameters<typeof HomologacaoProductionEvidenceCard>[0])} />);
  return props;
}

const type = (testId: string, value: string): void => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

function fillAndConfirm(): void {
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

describe('the production evidence raises everything it can at once (FUT-5519)', () => {
  it('fires the Pix before the cards are encrypted, Apple Pay in its sheet, and phase 2 raises only the cards', async () => {
    const sheets = installApplePay();
    const order: string[] = [];
    const encrypt = vi.fn(() => {
      order.push('encrypt');
      return { hasErrors: true, errors: [] };
    });
    (window as { PagSeguro?: unknown }).PagSeguro = { encryptCard: encrypt };
    const props = mount(order);
    fireEvent.click(screen.getByTestId('evidence-apple-pay'));

    fillAndConfirm();
    await waitFor(() => expect(order).toContain('now:pix'));
    await act(async () => sheets[0]?.authorize());

    await waitFor(() => expect(props.onRun).toHaveBeenCalledTimes(1));
    expect(order.indexOf('now:pix')).toBeLessThan(order.indexOf('encrypt'));
    expect(order).toContain('now:APPLE_PAY');
    expect(order.at(-1)).toBe('run');
    expect(sheets[0]?.completions).toEqual([{ status: 0 }]);
    const args = props.onRun.mock.calls[0] as unknown[];
    expect(args[5]).toEqual(['CARD', 'DEBIT']);
    expect(args[2]).toEqual([]);
  });

  it('shows the Pix done while the cards are still being prepared', async () => {
    installApplePay();
    const order: string[] = [];
    const gate: { release?: () => void } = {};
    (window as { PagSeguro?: unknown }).PagSeguro = {
      encryptCard: vi.fn(() => ({ hasErrors: true, errors: [] })),
    };
    const props = mount(order);
    props.onRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.release = () => resolve({ pix: REFUNDED, scenarios: null });
        }),
    );

    fillAndConfirm();

    await waitFor(() => expect(screen.getByTestId('evidence-step-PIX').getAttribute('data-state')).toBe('done'));
    expect(screen.getByTestId('evidence-step-CARD').getAttribute('data-state')).toBe('current');
    gate.release?.();
  });
});
