/**
 * The failover chain, from the buyer's side (FUT-743 / FUT-563).
 *
 * A card instrument is bound to whoever minted it, so a charge can only fail
 * over onto a provider the BROWSER also tokenized for. That makes the chain a
 * frontend concern as much as a gateway one, and it makes one rule load
 * bearing:
 *
 *   `tokensByProvider` is sent iff the SERVER-PUBLISHED CHAIN has more than one
 *   entry — never iff more than one instrument happened to mint.
 *
 * Both cases below exist to hold that line, and they fail in opposite
 * directions:
 *
 *   - TWO MINTABLE ENTRIES. The map carries one instrument per entry, with
 *     different tokens; the head is provably-not-charged, the walk advances,
 *     and the tail settles with nothing re-typed. Any factory-level filtering
 *     or de-duplication of `providerConfig.chain` shows up here as a missing
 *     key.
 *   - A REDIRECT HEAD AND A MINTABLE TAIL. The card form IS shown (somebody in
 *     the chain tokenizes), the bare token is minted from the TAIL rather than
 *     the head, and the map is STILL SENT even though exactly one instrument
 *     minted. Count the map instead of the chain and it disappears here — the
 *     server then reads the bare token as the HEAD's and refuses every other
 *     entry as "holding someone else's instrument", including the one that
 *     needed none. That is the whole card path of every REDIRECT-headed store
 *     that adds a backup provider, and enabling a provider APPENDS it, so the
 *     shape arises with no reordering.
 *
 * The head fails as `ECONNREFUSED`, not as a decline: a decline does not
 * advance a `TECHNICAL` chain, and it should not — only a failure that PROVES
 * nothing was charged entitles the walk to try somebody else.
 */
import type { JSX } from 'react';

import { checkoutCase, hostedPage, mintable } from '../payments/cases';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';

const CASES: HarnessCase[] = [
  checkoutCase('two-mintable', 'Two mintable entries', {
    chain: [
      mintable('boreal', ['CARD'], { unreachable: true }),
      mintable('aurora', ['CARD']),
    ],
  }),
  checkoutCase('redirect-head', 'REDIRECT head, mintable tail', {
    chain: [hostedPage('infinito', ['CARD']), mintable('aurora', ['CARD'])],
  }),
];

export function PaymentsCheckoutChainFailoverPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · provider chain">
        One card, typed once, against a two-entry chain. The wire probe prints the{' '}
        <code>tokensByProvider</code> keys the published client sent and the token each provider
        actually received — the two facts that decide whether card failover works at all.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
