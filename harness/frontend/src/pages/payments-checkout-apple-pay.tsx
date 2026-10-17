/**
 * An APPLE PAY checkout, end to end, against a real mount (FUT-472).
 *
 * The store's chain head declares the `APPLE_PAY` wallet capability, so both
 * published gates run for real — the capability read (`applePayDeclared`,
 * fail-closed) and the DEVICE feature-detect (`ApplePaySession` exists and
 * `canMakePayments()`), which is the half Google Pay does not have.
 *
 * The store opens on the ONE list (FUT-3685), dressed as the origin host's
 * storefront: the button is in "PAGAMENTO RÁPIDO", the session is created
 * inside the tap, priced at the amount due, and the order is raised behind it.
 *
 * Two cases, and the device gate is why they are cases of one page:
 *
 *   - `no-device` (the DEFAULT, deliberately first): no `ApplePaySession`
 *     anywhere — every non-Safari browser, this harness's own included. The
 *     fallback rule is the subject: no button, and the card row still sells.
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
import type { HarnessHost } from '../payments/host';
import { CaseTabs, PageIntro } from '../payments/panel';
import type { HarnessStoreSpec } from '../payments/store';
import { STOREFRONT_CART_CENTS } from '../payments/storefront-look';
import { installApplePayStub, validateHarnessApplePayMerchant } from '../payments/wallet-stubs';

/** One chain entry declaring CARD plus the Apple Pay wallet. */
const STORE: HarnessStoreSpec = {
  amountCents: STOREFRONT_CART_CENTS,
  chain: [mintable('aurora', ['CARD'], { wallets: ['APPLE_PAY'] })],
};

/** The host half: merchant validation answered like a real server would, on the one list. */
const HOST: HarnessHost = {
  storefront: true,
  validateApplePayMerchant: validateHarnessApplePayMerchant,
};

/** Install the stub during render — before any child can feature-detect. */
function WithApplePayDevice({ children }: { children: ReactNode }): ReactNode {
  installApplePayStub();
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
        One provider declaring CARD plus the <code>APPLE_PAY</code> wallet, on the ONE list. The
        session starts inside the tap; its stubbed <code>token.paymentData</code> crosses the flat{' '}
        <code>/charge</code> wire as <code>wallet: {'{ type, key }'}</code>; without{' '}
        <code>ApplePaySession</code> there is no &quot;Pagamento rápido&quot; and the card row
        still sells.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
