/**
 * An APPLE PAY checkout, end to end, against a real mount (FUT-472).
 *
 * The store's chain head declares the `APPLE_PAY` wallet capability, so both
 * published gates run for real — the capability read (`applePayDeclared`,
 * fail-closed) and the DEVICE feature-detect (`ApplePaySession` exists and
 * `canMakePayments()`), which is the half Google Pay does not have.
 *
 * Two cases, and the device gate is why they are cases of one page:
 *
 *   - `no-device` (the DEFAULT, deliberately first): no `ApplePaySession`
 *     anywhere — every non-Safari browser, this harness's own included. The
 *     fallback rule is the subject: no button, and the card form still sells.
 *   - `device`: a deterministic `ApplePaySession` stub installed DURING the
 *     case's render, before any button can feature-detect. Render-scoped, not
 *     module-scoped like the Google stub, because here the global's absence
 *     is itself a scenario — and one document never runs both cases in a
 *     journey (each scenario opens the page fresh).
 *
 * The journey's load-bearing assertion is the probe's `wallet:APPLE_PAY` tag:
 * the sheet's `token.paymentData` crossed the flat `/charge` wire serialized
 * verbatim and reached the provider as the charge's ONE instrument.
 */
import type { JSX, ReactNode } from 'react';

import { checkoutCase, mintable, MountedCheckout } from '../payments/cases';
import { CaseTabs, PageIntro } from '../payments/panel';
import type { HarnessStoreSpec } from '../payments/store';

/** One chain entry declaring CARD plus the Apple Pay wallet. */
const STORE: HarnessStoreSpec = {
  chain: [mintable('aurora', ['CARD'], { wallets: ['APPLE_PAY'] })],
};

/** The host half: merchant validation answered like a real server would. */
const HOST = {
  validateApplePayMerchant: async (): Promise<unknown> => ({ merchantSession: 'harness' }),
};

/** The payment-request slice the stub inspects. */
interface StubPaymentRequest {
  supportedNetworks?: readonly string[];
}

/**
 * A deterministic `ApplePaySession`: validates the merchant as soon as the
 * sheet opens, then authorizes with a fixed `token.paymentData` — the same
 * order Safari drives, synchronously so no scenario ever waits on a timer.
 */
class StubApplePaySession {
  static readonly STATUS_SUCCESS = 0;
  static readonly STATUS_FAILURE = 1;
  static canMakePayments(): boolean {
    return true;
  }

  onvalidatemerchant: ((event: { validationURL: string }) => void) | null = null;
  onpaymentauthorized:
    | ((event: { payment: { token: { paymentData: unknown } } }) => void)
    | null = null;
  oncancel: (() => void) | null = null;

  private readonly request: StubPaymentRequest;

  constructor(_version: number, request: StubPaymentRequest) {
    this.request = request;
  }

  begin(): void {
    this.onvalidatemerchant?.({ validationURL: 'https://apple.example/validate' });
  }

  abort(): void {
    // Nothing to tear down — the stub keeps no timers.
  }

  completeMerchantValidation(): void {
    this.onpaymentauthorized?.({
      payment: {
        token: {
          // The networks the sheet was asked for, echoed into the opaque
          // payload so a spec could pin the Visa/Mastercard-only constraint.
          paymentData: { stub: true, networks: this.request.supportedNetworks ?? [] },
        },
      },
    });
  }

  completePayment(): void {
    // The pane's own polling reports the outcome; nothing to record here.
  }
}

/** Install the stub during render — before any child can feature-detect. */
function WithApplePayDevice({ children }: { children: ReactNode }): ReactNode {
  (window as { ApplePaySession?: unknown }).ApplePaySession = StubApplePaySession;
  return children;
}

const CASES = [
  // FIRST, so it is the default render: the no-device case must never see the
  // stub another case installed.
  checkoutCase('no-device', 'Sem Apple Pay no aparelho', STORE, HOST),
  {
    id: 'device',
    label: 'Com Apple Pay',
    render: (): ReactNode => (
      <WithApplePayDevice>
        <MountedCheckout spec={STORE} host={HOST} label="apple-pay-device" />
      </WithApplePayDevice>
    ),
  },
];

export function PaymentsCheckoutApplePayPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · Apple Pay (wallet)">
        One provider declaring CARD plus the <code>APPLE_PAY</code> wallet. The stubbed
        session&apos;s <code>token.paymentData</code> crosses the flat <code>/charge</code> wire as{' '}
        <code>wallet: {'{ type, key }'}</code>; without <code>ApplePaySession</code> the button never
        renders and the card form still sells.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
