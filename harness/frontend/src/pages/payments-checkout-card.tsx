/**
 * A CARD checkout, end to end, against a real mount (FUT-743).
 *
 * This page is the one that would have caught two of FUT-740's three
 * criticals, and it is worth being precise about why:
 *
 *   - The `/charge` body the shipped client posts is FLAT
 *     (`{ orderId, token, tokensByProvider?, saveCard, cardMeta, taxId }`).
 *     A mount that only read a nested `card` block received `card: undefined`
 *     from every deployed browser, charged nothing, and told the buyer their
 *     card was declined. The wire probe below prints the body's own keys, so a
 *     re-nesting is a failing string comparison rather than a support ticket.
 *   - The buyer's CPF has no column on a payable, so it can only travel with
 *     the request that RAISES one. The probe prints the taxId each provider
 *     actually received; a CPF that never got there is visible here before it
 *     is visible as a 400 after the buyer has finished the form.
 *
 * The store declares CARD only, so the sole method is preselected and the form
 * is reached with no picker tap.
 */
import type { JSX } from 'react';

import { MountedCheckout, mintable } from '../payments/cases';
import { PageIntro } from '../payments/panel';

export function PaymentsCheckoutCardPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · card (PUBLIC_KEY)">
        One provider declaring CARD, tokenizing with a public key in the browser. The published
        client&apos;s FLAT <code>/charge</code> body reaches a real <code>createPaymentFlowsBE</code>{' '}
        mount, and the provider receives the minted instrument together with the buyer&apos;s CPF.
      </PageIntro>
      <MountedCheckout spec={{ chain: [mintable('aurora', ['CARD'])] }} label="card" />
    </>
  );
}
