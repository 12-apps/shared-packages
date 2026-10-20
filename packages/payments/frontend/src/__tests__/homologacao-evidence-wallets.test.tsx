// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserCardResult, BrowserWalletResult, EvidenceWalletsConfig } from '@12-apps/payments-backend';

import type { ApplePayPaymentRequest } from '../components/checkout/apple-pay-button';
import type { GooglePayApi } from '../components/checkout/google-pay-button';
import { HomologacaoEvidenceCard, type HomologacaoSellerView } from '../components/platform/HomologacaoEvidenceCard';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/pt-BR';

/**
 * The evidence card's wallet step (FUT-3755). Pinned: Google Pay's sheet is
 * opened in TEST, always, against the test seller's PagBank account; Apple
 * Pay is drawn only where an `ApplePaySession` exists AND the host has an
 * identity AND validates the merchant; a pressed wallet shows its card, never
 * its token; and "generate" hands each wallet's answer — or why there is none
 * — to phase 2.
 *
 * jest-dom is not a dependency here, so DOM properties are asserted directly.
 */

const WALLETS: EvidenceWalletsConfig = {
  amountCents: 1200,
  googlePay: { gateway: 'pagbank', gatewayMerchantId: 'ACCO_TEST', environment: 'TEST' },
  applePay: { configured: false },
};

const SELLER: HomologacaoSellerView = {
  connected: true,
  environment: 'SANDBOX',
  status: 'VERIFIED',
  connectedAt: '2026-10-17T15:00:00Z',
  accountId: 'ACCO_TEST',
  wallets: WALLETS,
};

afterEach(() => {
  cleanup();
  delete (window as { ApplePaySession?: unknown }).ApplePaySession;
});

/** The pay.js surface, recorded: the environment each client was built in, and each sheet request. */
function fakeGooglePay(options: { ready?: boolean; rejectWith?: unknown } = {}) {
  const calls = { environments: [] as string[], requests: [] as Record<string, unknown>[] };
  class PaymentsClient {
    constructor(clientOptions: { environment: 'TEST' | 'PRODUCTION' }) {
      calls.environments.push(clientOptions.environment);
    }
    async isReadyToPay(): Promise<{ result: boolean }> {
      return { result: options.ready ?? true };
    }
    createButton({ onClick }: { onClick: () => void }): HTMLElement {
      const button = document.createElement('button');
      button.setAttribute('data-testid', 'google-pay-native');
      button.addEventListener('click', onClick);
      return button;
    }
    async loadPaymentData(request: Record<string, unknown>) {
      calls.requests.push(request);
      if (options.rejectWith !== undefined) throw options.rejectWith;
      return {
        paymentMethodData: {
          tokenizationData: { token: '{"signedMessage":"gpay-secret-token"}' },
          info: { cardNetwork: 'VISA', cardDetails: '1111' },
        },
      };
    }
  }
  return { api: { PaymentsClient } satisfies GooglePayApi, calls };
}

/** One faked ApplePaySession; its handlers are driven by the test. Fields are containers, never rebound. */
class FakeSession {
  onvalidatemerchant: ((event: { validationURL: string }) => void) | null = null;
  onpaymentauthorized: ((event: { payment: { token: { paymentData: unknown; paymentMethod?: { network?: string; displayName?: string } } } }) => void) | null = null;
  oncancel: (() => void) | null = null;
  state = { begun: false, aborted: false };
  merchantSessions: unknown[] = [];
  completions: { status: number }[] = [];
  begin(): void {
    this.state.begun = true;
  }
  abort(): void {
    this.state.aborted = true;
  }
  completeMerchantValidation(merchantSession: unknown): void {
    this.merchantSessions.push(merchantSession);
  }
  completePayment(result: { status: number }): void {
    this.completions.push(result);
  }
}

function installApplePay() {
  const world = { requests: [] as ApplePayPaymentRequest[], sessions: [] as FakeSession[] };
  class Session extends FakeSession {
    static STATUS_SUCCESS = 0;
    static STATUS_FAILURE = 1;
    static canMakePayments(): boolean {
      return true;
    }
    constructor(_version: number, request: ApplePayPaymentRequest) {
      super();
      world.requests.push(request);
      world.sessions.push(this);
    }
  }
  (window as { ApplePaySession?: unknown }).ApplePaySession = Session;
  return world;
}

function mount(overrides: Partial<Parameters<typeof HomologacaoEvidenceCard>[0]> = {}) {
  const ran: { cards: BrowserCardResult[]; wallets: BrowserWalletResult[] }[] = [];
  const props = {
    copy: PT_BR_PLATFORM_HOMOLOGACAO_COPY,
    seller: SELLER,
    onConnect: vi.fn(async () => undefined),
    onPrepare: vi.fn(async () => ({ runId: 'run-1', publicKey: null })),
    onRun: vi.fn(async (_runId: string, cards: BrowserCardResult[], wallets: BrowserWalletResult[]) => {
      ran.push({ cards, wallets });
    }),
    onDownload: vi.fn(async () => ({ executed: 1, failed: 0, pending: 0 })),
    googlePayApi: null,
    ...overrides,
  };
  render(<HomologacaoEvidenceCard {...props} />);
  return { props, ran };
}

const appleSeller = (configured: boolean): HomologacaoSellerView => ({
  ...SELLER,
  wallets: { ...WALLETS, googlePay: null, applePay: { configured } },
});

describe('HomologacaoEvidenceCard — the wallet step', () => {
  it("given a browser that can pay, then Google Pay's sheet opens in TEST against the seller's account for the fixed amount", async () => {
    const google = fakeGooglePay();
    mount({ googlePayApi: google.api });

    fireEvent.click(await screen.findByTestId('google-pay-native'));

    await waitFor(() => expect(google.calls.requests).toHaveLength(1));
    expect(google.calls.environments).toEqual(['TEST']);
    expect(google.calls.requests[0]).toMatchObject({
      allowedPaymentMethods: [
        { tokenizationSpecification: { type: 'PAYMENT_GATEWAY', parameters: { gateway: 'pagbank', gatewayMerchantId: 'ACCO_TEST' } } },
      ],
      transactionInfo: { totalPrice: '12.00', currencyCode: 'BRL' },
    });
  });

  it('given a pressed Google Pay, then the card shows it ready with its card and never its token, and generating sends the token', async () => {
    const google = fakeGooglePay();
    const { ran } = mount({ googlePayApi: google.api });

    fireEvent.click(await screen.findByTestId('google-pay-native'));
    const ready = await screen.findByTestId('evidence-wallet-ready-GOOGLE_PAY');
    expect(ready.textContent).toBe('Google Pay pronto — VISA •••• 1111. Será usado ao gerar o arquivo.');
    expect(document.body.textContent).not.toContain('gpay-secret-token');

    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(ran[0]?.wallets).toEqual([
      { type: 'GOOGLE_PAY', token: '{"signedMessage":"gpay-secret-token"}', brand: 'VISA', last4: '1111' },
      { type: 'APPLE_PAY', token: null, brand: null, last4: null, failure: 'NOT_CONFIGURED' },
    ]);
    // A token pays once: the run took it, and the ready line went with it.
    await waitFor(() => expect(document.querySelectorAll('[data-testid="evidence-wallet-ready-GOOGLE_PAY"]')).toHaveLength(0));
  });

  it('given the operator closes the sheet, then the card says no token came and the run says why', async () => {
    const google = fakeGooglePay({ rejectWith: { statusCode: 'CANCELED' } });
    const { ran } = mount({ googlePayApi: google.api });

    fireEvent.click(await screen.findByTestId('google-pay-native'));
    await screen.findByTestId('evidence-wallet-failed-GOOGLE_PAY');
    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(ran[0]?.wallets[0]).toEqual({ type: 'GOOGLE_PAY', token: null, brand: null, last4: null, failure: 'DISMISSED' });
  });

  it('given a browser that cannot do Google Pay, then no button is drawn and the run says it was not offered', async () => {
    const google = fakeGooglePay({ ready: false });
    const { ran } = mount({ googlePayApi: google.api });

    await waitFor(() => expect(google.calls.environments).toEqual(['TEST']));
    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(document.querySelectorAll('[data-testid="google-pay-native"]')).toHaveLength(0);
    expect(ran[0]?.wallets[0]).toMatchObject({ type: 'GOOGLE_PAY', token: null, failure: 'NOT_AVAILABLE' });
  });

  it('given no button pressed on a browser that can pay, then generating sends no Google Pay result — the section reads "not executed"', async () => {
    const google = fakeGooglePay();
    const { ran } = mount({ googlePayApi: google.api });

    await screen.findByTestId('google-pay-native');
    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(ran[0]?.wallets.map((wallet) => wallet.type)).toEqual(['APPLE_PAY']);
  });

  it('given Apple Pay is not configured, then its button is not drawn even where ApplePaySession exists', () => {
    installApplePay();
    mount({ seller: appleSeller(false), onValidateApplePayMerchant: vi.fn(async () => ({})) });

    expect(document.querySelectorAll('[data-testid="evidence-apple-pay"]')).toHaveLength(0);
  });

  it('given Apple Pay is configured but the browser has no ApplePaySession, then its button is not drawn and the run says so', async () => {
    const { ran } = mount({ seller: appleSeller(true), onValidateApplePayMerchant: vi.fn(async () => ({})) });

    expect(document.querySelectorAll('[data-testid="evidence-apple-pay"]')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(ran[0]?.wallets).toEqual([{ type: 'APPLE_PAY', token: null, brand: null, last4: null, failure: 'NOT_AVAILABLE' }]);
  });

  it('given Apple Pay is not configured, then the card says it waits for the Apple Developer account', () => {
    mount({ seller: appleSeller(false), onValidateApplePayMerchant: vi.fn(async () => ({})) });

    expect(screen.getByTestId('evidence-apple-pay-absent').textContent).toBe(
      PT_BR_PLATFORM_HOMOLOGACAO_COPY.evidence.wallets.applePayAbsent.NOT_CONFIGURED,
    );
  });

  it('given Apple Pay is configured but the browser has no ApplePaySession, then the card says to open it in Safari', () => {
    mount({ seller: appleSeller(true), onValidateApplePayMerchant: vi.fn(async () => ({})) });

    expect(screen.getByTestId('evidence-apple-pay-absent').textContent).toBe(
      PT_BR_PLATFORM_HOMOLOGACAO_COPY.evidence.wallets.applePayAbsent.NOT_AVAILABLE,
    );
  });

  it('given Apple Pay drawn, then no absence line is shown', () => {
    installApplePay();
    mount({ seller: appleSeller(true), onValidateApplePayMerchant: vi.fn(async () => ({})) });

    expect(screen.getByTestId('evidence-apple-pay')).toBeTruthy();
    expect(document.querySelectorAll('[data-testid="evidence-apple-pay-absent"]')).toHaveLength(0);
  });

  it('given a host with no merchant validation, then Apple Pay is not drawn and the run says the validation cannot run', async () => {
    installApplePay();
    const { ran } = mount({ seller: appleSeller(true) });

    expect(document.querySelectorAll('[data-testid="evidence-apple-pay"]')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(ran[0]?.wallets[0]).toMatchObject({ type: 'APPLE_PAY', failure: 'MERCHANT_VALIDATION_FAILED' });
  });

  it("given Apple Pay configured, when pressed, then the host validates the merchant and the authorized token is kept and sent", async () => {
    const apple = installApplePay();
    const validate = vi.fn<(validationURL: string) => Promise<unknown>>(async () => ({ merchantSessionIdentifier: 'ms-1' }));
    const { ran } = mount({ seller: appleSeller(true), onValidateApplePayMerchant: validate });

    fireEvent.click(screen.getByTestId('evidence-apple-pay'));
    const session = apple.sessions[0]!;
    expect(session.state.begun).toBe(true);
    expect(apple.requests[0]).toMatchObject({ total: { label: 'Teste de homologação', amount: '12.00' }, currencyCode: 'BRL' });
    await act(async () => session.onvalidatemerchant?.({ validationURL: 'https://apple-pay-gateway.apple.com/paymentservices/startSession' }));
    expect(validate).toHaveBeenCalledWith('https://apple-pay-gateway.apple.com/paymentservices/startSession');
    expect(session.merchantSessions).toEqual([{ merchantSessionIdentifier: 'ms-1' }]);
    await act(async () =>
      session.onpaymentauthorized?.({
        payment: { token: { paymentData: { data: 'apay-secret' }, paymentMethod: { network: 'Visa', displayName: 'Visa 4242' } } },
      }),
    );

    expect((await screen.findByTestId('evidence-wallet-ready-APPLE_PAY')).textContent).toContain('Apple Pay pronto — Visa •••• 4242');
    // The order comes later, at "generate": the sheet is closed now.
    expect(session.completions).toEqual([{ status: 0 }]);
    fireEvent.click(screen.getByTestId('evidence-generate'));
    await waitFor(() => expect(ran).toHaveLength(1));
    expect(ran[0]?.wallets).toEqual([{ type: 'APPLE_PAY', token: '{"data":"apay-secret"}', brand: 'Visa', last4: '4242' }]);
  });

  it('given the merchant validation fails, then the run says the validation did not complete', async () => {
    const apple = installApplePay();
    const { ran } = mount({ seller: appleSeller(true), onValidateApplePayMerchant: vi.fn(async () => Promise.reject(new Error('NOT_CONFIGURED'))) });

    fireEvent.click(screen.getByTestId('evidence-apple-pay'));
    await act(async () => apple.sessions[0]?.onvalidatemerchant?.({ validationURL: 'https://apple-pay-gateway.apple.com/x' }));
    await screen.findByTestId('evidence-wallet-failed-APPLE_PAY');
    fireEvent.click(screen.getByTestId('evidence-generate'));

    await waitFor(() => expect(ran).toHaveLength(1));
    expect(apple.sessions[0]?.state.aborted).toBe(true);
    expect(ran[0]?.wallets).toEqual([
      { type: 'APPLE_PAY', token: null, brand: null, last4: null, failure: 'MERCHANT_VALIDATION_FAILED' },
    ]);
  });

  it('given a host whose seller view carries no wallets, then no wallet step is drawn', () => {
    mount({ seller: { ...SELLER, wallets: undefined }, googlePayApi: fakeGooglePay().api });

    expect(document.querySelectorAll('[data-testid="evidence-wallets"]')).toHaveLength(0);
  });
});
