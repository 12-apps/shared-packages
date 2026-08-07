/**
 * Reusing a vaulted card, and the refusal that must not read as a decline
 * (FUT-743 / FUT-697).
 *
 * The saved-card list is SCOPED to the store being paid: only instruments the
 * store's own provider can charge come back, because offering one it cannot
 * charge produces a decline that blames the buyer's card for the merchant's
 * configuration. The third case here is what happens when an id the caller
 * genuinely owns reaches a scope that cannot charge it — the mount answers 409
 * `INSTRUMENT_NOT_USABLE` with its own copy ("this card cannot be used at this
 * store — enter the card details again"), which is a different sentence and a
 * different remedy from "declined".
 *
 * The empty case matters for its own reason: an empty list must render no
 * picker at all rather than a one-option radiogroup, and take the buyer
 * straight to the new-card form.
 */
import type { JSX } from 'react';

import { checkoutCase, mintable } from '../payments/cases';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';
import type { HarnessStoreSpec } from '../payments/store';

/** The same card store every case is set at; only the vault differs. */
function vaultedWith(vault: Pick<HarnessStoreSpec, 'instruments' | 'unusableInstruments'>) {
  return { chain: [mintable('aurora', ['CARD'])], ...vault };
}

const CASES: HarnessCase[] = [
  checkoutCase(
    'list-present',
    'One vaulted card',
    vaultedWith({ instruments: [{ id: 'card_visa_4242', last4: '4242', brand: 'visa' }] }),
  ),
  checkoutCase('list-empty', 'No vaulted cards', vaultedWith({ instruments: [] })),
  checkoutCase(
    'scope-mismatch',
    'Owned, not usable here',
    vaultedWith({
      instruments: [{ id: 'card_other_1881', last4: '1881', brand: 'elo' }],
      unusableInstruments: ['card_other_1881'],
    }),
  ),
];

export function PaymentsCheckoutSavedCardsPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · saved cards">
        A vaulted instrument reused over the real wire, an empty list that renders no picker, and
        an id this caller owns that this store cannot charge — answered as &ldquo;not usable
        here&rdquo;, never as a decline.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
