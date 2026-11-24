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
 * FUT-5519, the owner's option (b): Apple Pay is charged in Apple's own sheet.
 * Its token lives minutes and the sheet waits 30 s, so the press only
 * includes it; the sheet opens on the charge's confirm, the Apple Pay order is
 * raised on the prepared run while the sheet is open, and the sheet closes
 * with PagBank's answer. The run then raises the rest without Apple Pay.
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

function mount(onChargeApplePay: (runId: string, wallet: BrowserWalletResult) => Promise<{ paid: boolean }>) {
  const props = {
    copy: PT_BR_PLATFORM_HOMOLOGACAO_COPY,
    seller: SELLER,
    onConnect: vi.fn(async () => undefined),
    onPrepare: vi.fn(async () => ({ runId: 'run-1', publicKey: 'PUBKEY' })),
    onChargeApplePay: vi.fn(onChargeApplePay),
    onRun: vi.fn(async () => ({ pix: REFUNDED, scenarios: null })),
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

describe('the production evidence charges Apple Pay in its sheet (FUT-5519)', () => {
  it('opens no sheet on the press: Apple Pay is only included in the charge', () => {
    const sheets = installApplePay();
    mount(async () => ({ paid: true }));

    fireEvent.click(screen.getByTestId('evidence-apple-pay'));

    expect(sheets).toHaveLength(0);
    expect(screen.getByTestId('evidence-wallet-included-APPLE_PAY').textContent).toBe(
      PT_BR_PLATFORM_HOMOLOGACAO_COPY.evidence.wallets.applePayIncluded,
    );
  });

  it('opens the sheet on confirm, charges it on the prepared run, closes it paid, and runs the rest without Apple Pay', async () => {
    const sheets = installApplePay();
    const props = mount(async () => ({ paid: true }));
    fireEvent.click(screen.getByTestId('evidence-apple-pay'));

    fillAndConfirm();

    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.begun).toBe(true);
    await waitFor(() => expect(props.onPrepare).toHaveBeenCalledTimes(1));
    await act(async () => sheets[0]?.authorize());

    await waitFor(() => expect(props.onRun).toHaveBeenCalledTimes(1));
    expect(props.onChargeApplePay).toHaveBeenCalledWith(
      'run-1',
      { type: 'APPLE_PAY', token: '{"data":"apay-secret"}', brand: 'Visa', last4: '4242' },
      expect.objectContaining({ name: 'Comprador Teste' }),
    );
    expect(sheets[0]?.completions).toEqual([{ status: 0 }]);
    const wallets = (props.onRun.mock.calls[0] as unknown[] | undefined)?.[2] as BrowserWalletResult[];
    expect(wallets.filter((wallet) => wallet.type === 'APPLE_PAY')).toEqual([]);
  });

  it('closes the sheet as failed when PagBank did not charge it', async () => {
    const sheets = installApplePay();
    const props = mount(async () => ({ paid: false }));
    fireEvent.click(screen.getByTestId('evidence-apple-pay'));

    fillAndConfirm();
    await act(async () => sheets[0]?.authorize());

    await waitFor(() => expect(props.onRun).toHaveBeenCalledTimes(1));
    expect(sheets[0]?.completions).toEqual([{ status: 1 }]);
  });

  it('given the sheet is closed without paying, then nothing is charged and the run records it as dismissed', async () => {
    const sheets = installApplePay();
    const props = mount(async () => ({ paid: true }));
    fireEvent.click(screen.getByTestId('evidence-apple-pay'));

    fillAndConfirm();
    await act(async () => sheets[0]?.cancel());

    await waitFor(() => expect(props.onRun).toHaveBeenCalledTimes(1));
    expect(props.onChargeApplePay).not.toHaveBeenCalled();
    expect(sheets[0]?.completions).toEqual([]);
    const wallets = (props.onRun.mock.calls[0] as unknown[] | undefined)?.[2] as BrowserWalletResult[];
    expect(wallets).toEqual([{ type: 'APPLE_PAY', token: null, brand: null, last4: null, failure: 'DISMISSED' }]);
  });
});
