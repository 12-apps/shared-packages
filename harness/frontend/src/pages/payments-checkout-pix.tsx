/**
 * PIX, end to end, against a real mount (FUT-743).
 *
 * The store's chain declares PIX and nothing else, so there is no choice to
 * make: the picker renders one tile, preselects it, and the order is raised
 * with no extra tap. The QR is rendered from the copia-e-cola payload the
 * PROVIDER produced and the HOST carried forward in its own view — the library
 * answers a PIX create with the host's view and nothing else, so a payload that
 * did not survive that hop is a payment step with no code on it.
 *
 * ## Two cases, because a QR has two lives
 *
 * A buyer sits looking at an unpaid code for as long as it takes them to open
 * their bank, and then it settles. Those are different screens and the second
 * REPLACES the first: the poll advances the flow to the confirmation step, so
 * the picker and the QR are gone. Asserting both against one store means racing
 * a 2.5-second poll, which is a flake waiting to be filed as a bug. So they are
 * declared separately — one provider nobody has paid, one that answers the poll
 * — and each case asserts only what is true in it.
 *
 * When it does settle, nothing is faked past the credentials: `GET /status`
 * asks the provider, the provider says PAID, and the mount applies it through
 * the host's own `correlation.settle`.
 */
import type { JSX } from 'react';

import { checkoutCase, mintable } from '../payments/cases';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';

/**
 * `mintable` even though this store never asks for a card.
 *
 * What `tokenization` says is whether the browser has a card path AT ALL, and
 * the mount reads a chain where nobody has one as "everybody settles on the
 * provider's own page" — so a PIX-only provider declaring the honest `NONE` has
 * its PIX raise answered as a redirect charge with no link, which throws. See
 * FINDINGS in the PR. `methods` is what actually makes this store PIX-only.
 */
function pixStore(settlesOnPoll: boolean) {
  return { chain: [mintable('aurora', ['PIX'], { settlesOnPoll })] };
}

const CASES: HarnessCase[] = [
  checkoutCase('awaiting', 'Nobody has paid yet', pixStore(false)),
  checkoutCase('settles', 'The poll settles PAID', pixStore(true)),
];

export function PaymentsCheckoutPixPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · PIX only">
        One provider, declaring PIX only. The method picker offers a single tile and preselects it,
        the QR comes from the payload the provider minted, and — in the second case — the poll
        settles the payable PAID through the host&apos;s own settlement port.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
