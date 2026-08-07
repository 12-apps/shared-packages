/**
 * The buyer screen comes from what the ADAPTER declared (FUT-596).
 *
 * Four stores, identical in every way a host can see except one declaration,
 * each driven through the real mount so the id makes the round trip it makes
 * in production: declared on the adapter → stamped by the gateway onto every
 * chain entry → published by `GET /checkout/config` → resolved to a component
 * by the checkout. A unit test can pin the resolver; only this page proves the
 * id survives the wire.
 *
 * ## Why no vendor is named here
 *
 * Every provider below is fictional, and that is not decoration. A screen id
 * names the SHAPE of a flow — `pix-and-card`, `hosted-link` — never the
 * vendor, so a store called `aurora` reaches exactly the component a real
 * on-page acquirer would. It is also what keeps this file legal: outside
 * `packages/payments/**` a vendor-name literal is a hard error
 * (`payments/no-provider-name-literal`), so a vendor-keyed registry could not
 * have been demonstrated from a host at all — which is a good sign about the
 * contract, and part of why it was chosen.
 *
 * ## The last two cases are the important ones
 *
 * `sem-declaracao` declares no screen, which is Stone and Stripe today, and
 * must still check out. `do-futuro` declares an id this bundle has never
 * shipped — a newer backend against an older frontend, which is an ordinary
 * deployment state because the two packages version independently. Both must
 * degrade to the capability default rather than to an empty pane.
 */
import type { JSX } from 'react';

import { checkoutCase, hostedPage, mintable } from '../payments/cases';
import { CaseTabs, PageIntro } from '../payments/panel';

export function PaymentsCheckoutProviderScreensPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · provider screens (declared)">
        The same checkout, four stores. Each declares a different screen id — or none — and the
        pane that renders is whichever the adapter asked for. Nothing here names a vendor: the id
        names the shape of the flow, so one declaration serves any provider of that shape.
      </PageIntro>

      <CaseTabs
        cases={[
          checkoutCase('screen-on-page', 'Declares pix-and-card', {
            chain: [mintable('aurora', ['PIX', 'CARD'], { checkoutScreen: 'pix-and-card' })],
          }),
          checkoutCase('screen-handoff', 'Declares hosted-link', {
            chain: [hostedPage('boreal', ['PIX', 'CARD'], { checkoutScreen: 'hosted-link' })],
          }),
          checkoutCase('screen-undeclared', 'Declares nothing', {
            chain: [mintable('sem-declaracao', ['PIX', 'CARD'])],
          }),
          checkoutCase('screen-unknown', 'Declares an unknown id', {
            chain: [
              mintable('do-futuro', ['PIX', 'CARD'], { checkoutScreen: 'boleto-and-wallet' }),
            ],
          }),
        ]}
      />
    </>
  );
}
