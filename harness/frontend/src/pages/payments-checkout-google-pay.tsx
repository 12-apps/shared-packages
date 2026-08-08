/**
 * A GOOGLE PAY checkout, end to end, against a real mount (FUT-471).
 *
 * The store's chain head declares the `GOOGLE_PAY` wallet capability and
 * publishes the PAYMENT_GATEWAY parameters, so the published button gating
 * (`googlePayConfig`, fail-closed) and the published walk's wallet capability
 * gate both run for real. What a harness browser genuinely cannot have is
 * Google's `pay.js` — a page must not call Google to render — so this page
 * installs a deterministic `google.payments.api` stub BEFORE the checkout
 * mounts, which is exactly the seam the shipped button reads first (an
 * installed global is used without a network request).
 *
 * The journey's load-bearing assertion is the probe's provider-charge line:
 * `wallet:GOOGLE_PAY` proves the sheet's token crossed the flat `/charge`
 * wire, survived the mount's draft reader, and reached the provider as the
 * charge's ONE instrument.
 */
import type { JSX } from 'react';

import { MountedCheckout, mintable } from '../payments/cases';
import { PageIntro } from '../payments/panel';

/** The token the stubbed sheet answers with — asserted nowhere by value. */
const SHEET_TOKEN = 'gp_harness_token';

/** The slice of `google.payments.api` the shipped button drives. */
interface StubPaymentDataRequest {
  transactionInfo?: { totalPrice?: string };
}

/**
 * A deterministic `PaymentsClient`: ready to pay, renders a plain button (the
 * real one is drawn by Google's script, which is the one thing stubbed here),
 * and answers `loadPaymentData` with a fixed token in Google's shape.
 */
class StubPaymentsClient {
  isReadyToPay(): Promise<{ result: boolean }> {
    return Promise.resolve({ result: true });
  }

  createButton({ onClick }: { onClick: () => void }): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Pagar com Google Pay';
    button.addEventListener('click', onClick);
    return button;
  }

  loadPaymentData(request: StubPaymentDataRequest): Promise<{
    paymentMethodData: { tokenizationData: { token: string } };
  }> {
    // The request's own total rides into the token so a spec COULD pin that
    // the sheet was asked for the server-authoritative price.
    const price = request.transactionInfo?.totalPrice ?? '?';
    return Promise.resolve({
      paymentMethodData: { tokenizationData: { token: `${SHEET_TOKEN}_${price}` } },
    });
  }
}

// Installed at MODULE scope — before any React render, exactly as a real page
// that loaded pay.js in its <head> would look to the button. Global on
// purpose: every other store's chain declares no wallet, so the fail-closed
// gate must keep the button away REGARDLESS of the API being present — which
// is the second scenario of the packaged journey.
(window as unknown as { google?: unknown }).google = {
  payments: { api: { PaymentsClient: StubPaymentsClient } },
};

export function PaymentsCheckoutGooglePayPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · Google Pay (wallet)">
        One provider declaring CARD plus the <code>GOOGLE_PAY</code> wallet, with the
        PAYMENT_GATEWAY parameters published on the chain head. The stubbed sheet&apos;s token
        crosses the flat <code>/charge</code> wire as <code>wallet: {'{ type, key }'}</code> and the
        probe prints the instrument the provider actually received.
      </PageIntro>
      <MountedCheckout
        spec={{
          chain: [
            mintable('aurora', ['CARD'], {
              wallets: ['GOOGLE_PAY'],
              googlePayMerchantId: 'harness-mid-1',
            }),
          ],
        }}
        label="google-pay"
      />
    </>
  );
}
