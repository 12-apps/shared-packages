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
 * The store opens on the ONE list (FUT-3685), dressed as the origin host's
 * storefront: the button is in "PAGAMENTO RÁPIDO", above the rows, and the
 * buyer's CPF is asked once at the top because the sheet cannot supply it.
 *
 * The journey's load-bearing assertion is the probe's provider-charge line:
 * `wallet:GOOGLE_PAY` proves the sheet's token crossed the flat `/charge`
 * wire, survived the mount's draft reader, and reached the provider as the
 * charge's ONE instrument.
 */
import type { JSX } from 'react';

import { MountedCheckout, mintable } from '../payments/cases';
import { PageIntro } from '../payments/panel';
import { STOREFRONT_CART_CENTS } from '../payments/storefront-look';
import { installGooglePayStub } from '../payments/wallet-stubs';

// Installed at MODULE scope — before any React render, exactly as a real page
// that loaded pay.js in its <head> would look to the button. Global on
// purpose: every other store's chain declares no wallet, so the fail-closed
// gate must keep the button away REGARDLESS of the API being present — which
// is the second scenario of the packaged journey.
installGooglePayStub();

export function PaymentsCheckoutGooglePayPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · Google Pay (wallet)">
        One provider declaring CARD plus the <code>GOOGLE_PAY</code> wallet, with the
        PAYMENT_GATEWAY parameters published on the chain head, on the ONE list: the CPF at the
        top, the button in &quot;Pagamento rápido&quot;. The stubbed sheet&apos;s token crosses the
        flat <code>/charge</code> wire as <code>wallet: {'{ type, key }'}</code> and the probe
        prints the instrument the provider actually received.
      </PageIntro>
      <MountedCheckout
        spec={{
          amountCents: STOREFRONT_CART_CENTS,
          chain: [
            mintable('aurora', ['CARD'], {
              wallets: ['GOOGLE_PAY'],
              googlePayMerchantId: 'harness-mid-1',
            }),
          ],
        }}
        host={{ storefront: true }}
        label="google-pay"
      />
    </>
  );
}
