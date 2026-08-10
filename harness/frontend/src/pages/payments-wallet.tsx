/**
 * The buyer's wallet, OUTSIDE any purchase (FUT-183 over FUT-478's buyer
 * rows).
 *
 * `screens.ManageCards` is the whole page: the saved list (empty at first, so
 * the invite renders), the door into `screens.AddCard`, and the add flow's
 * begin → tokenize-in-the-browser → complete round trip — all over the same
 * real `createPaymentFlowsBE` mount every checkout page drives, with the
 * host's vault port answering the ownership facts server-side.
 *
 * One store, and the CARD decides the outcome: the package's own decline PAN
 * mints the stub's refused token, so the same mount serves the happy path, the
 * validation refusal (worded field-level by the host's `mapProviderError`),
 * and the saved list showing display metadata — never the vault token, which
 * only ever reaches the host's own rows (`provider-vaulted` on the probe).
 *
 * There is deliberately no delete affordance to exercise: PagBank publishes no
 * token-delete endpoint and S2 exposes no buyer forget, so the manage screen
 * ships without one — see the package's `flows/screens-vault.tsx`.
 */
import type { JSX } from 'react';

import { mintable } from '../payments/cases';
import { HarnessFlow } from '../payments/host';
import { PageIntro } from '../payments/panel';
import { WireProbe } from '../payments/probe';

/** One mintable provider whose connection can vault; the wallet starts empty. */
const SPEC = { chain: [mintable('aurora', ['CARD'], { vaultable: true })], instruments: [] };

export function PaymentsWalletPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Wallet · saving a card outside checkout">
        The published manage-cards screen over a real mount: an empty wallet that invites the
        first card, the add flow&apos;s begin → tokenize → complete round trip, a validation
        refusal that keeps the form editable under a field-level reason, and a saved list showing
        display metadata only — the vault token stays in the host&apos;s rows.
      </PageIntro>
      <HarnessFlow spec={SPEC}>
        {(flows, world) => (
          <>
            <flows.screens.ManageCards />
            <WireProbe world={world} label="wallet" />
          </>
        )}
      </HarnessFlow>
    </>
  );
}
