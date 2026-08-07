/**
 * The same checkout twice, through two design systems (FUT-743).
 *
 * The package's second-host claim is that behaviour and structure live in the
 * library and the pixels live in the host, behind nine primitive slots. In this
 * repo that claim has never actually been tested: the fallbacks are raw MUI and
 * the one real filling (`@12-apps/ui`) is MUI too, so a screen that reached for
 * MUI directly would render identically either way and nobody would know.
 *
 * Here the right-hand flow is filled with plain elements and no component
 * library at all. Two things have to hold, and a spec asserts both:
 *
 *   - the flow WORKS through the foreign slots — the same steps, the same
 *     picker, the same charge on the wire;
 *   - the TEST IDS are unchanged. An e2e selector must find the same hook
 *     whichever side of the seam drew it, or every existing spec silently
 *     becomes a spec about MUI.
 *
 * The foreign table fills seven of nine slots on purpose. `Partial` is the
 * contract, and the two it leaves out are the ones a nested provider would
 * quietly reset to raw MUI if inheritance ever broke.
 */
import type { JSX } from 'react';

import { foreignSlots } from '../payments/foreign-slots';
import { HarnessFlow } from '../payments/host';
import { PageIntro, Panel } from '../payments/panel';

const CHAIN = [
  {
    name: 'aurora' as const,
    tokenization: 'PUBLIC_KEY' as const,
    methods: ['PIX' as const, 'CARD' as const],
    publicKey: 'pk_harness_aurora',
    stub: true,
  },
];

export function PaymentsCheckoutSlotsPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · two design systems">
        The identical store, mounted twice: once on the raw-MUI defaults a host with no component
        library gets, once through a slot table built from plain elements. Same behaviour, same
        test ids, different pixels.
      </PageIntro>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <Panel id="slots-default" title="Default slots (raw MUI)">
          <HarnessFlow spec={{ chain: CHAIN }}>{(flows) => <flows.Checkout />}</HarnessFlow>
        </Panel>
        <Panel id="slots-foreign" title="Foreign slots (no component library)">
          <HarnessFlow spec={{ chain: CHAIN }} host={{ components: foreignSlots }}>
            {(flows) => <flows.Checkout />}
          </HarnessFlow>
        </Panel>
      </div>
    </>
  );
}
