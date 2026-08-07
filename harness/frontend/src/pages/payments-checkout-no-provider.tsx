/**
 * The store that cannot charge — and the two different reasons for it
 * (FUT-743).
 *
 * `storeCannotCharge` is an OR, never a swap, and this page is where that costs
 * something if it is ever narrowed:
 *
 *   - EMPTY CHAIN is the library's own fact: the server published no enabled
 *     provider. Nothing is offered, and — the assertion that matters — no
 *     picker, no card form and no `POST` ever appear. The only request on the
 *     wire is the config read.
 *   - THE HOST'S VETO is a different fact entirely: a store with a perfectly
 *     good chain that has switched online payments off. Decide on the chain
 *     alone and that store starts offering a checkout it will not honour, which
 *     is a live regression rather than a hypothetical — `apps/client` reads its
 *     own `onlinePayments` flag today.
 *
 * The remedy is the host's too, so both remedy-present and remedy-absent are
 * here: they are two different sentences, and a buyer who is told "call the
 * waiter" in a store with no waiter has been sent to a dead end.
 */
import type { JSX } from 'react';

import { checkoutCase, mintable } from '../payments/cases';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';

/** A chain that can charge — the fact the host's veto has to beat. */
const LIVE = { chain: [mintable('aurora', ['PIX', 'CARD'])] };
const NOTHING = { chain: [] };
const REMEDY = { label: 'Chamar garçom', onSelect: () => undefined };

const CASES: HarnessCase[] = [
  checkoutCase('empty-chain', 'Empty chain, no remedy', NOTHING),
  checkoutCase('empty-chain-remedy', 'Empty chain, host remedy', NOTHING, {
    availability: { payable: true, remedy: REMEDY },
  }),
  checkoutCase('host-veto', 'Host veto over a live chain', LIVE, {
    availability: { payable: false },
  }),
];

export function PaymentsCheckoutNoProviderPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · store cannot charge">
        Three ways to reach the same screen and two different sentences: an empty chain with and
        without a host remedy, and a host veto cast over a chain that would otherwise charge.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
