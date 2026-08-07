/**
 * The hosted handover, both legs, in a browser (FUT-743).
 *
 * A REDIRECT chain has no in-browser card path at all: the buyer types their
 * card on the provider's own page. So the assertion is a negative one — the
 * card FORM must never render — plus two positives that a bare
 * `window.location.assign` could not give:
 *
 *   - `HostedHandoff` PARKS the raised order and only then navigates, and
 *     renders a real anchor as the fallback. Park-then-navigate is load
 *     bearing: the navigation may tear the SPA down at any point after it
 *     starts, and a return trip that finds nothing parked drops the buyer on a
 *     blank confirmation after they have paid.
 *   - `HostedReturn` is the resume leg AS A SCREEN, so a host mounts it at its
 *     return route instead of hoping the buyer lands back on the exact
 *     component that left.
 *
 * The two legs are chosen by the URL, exactly as a real host routes them: a
 * request carrying `transaction_nsu` + `slug` is a buyer coming back, and only
 * the return leg renders. Rendering both would race — `takeHostedOrder` reads
 * AND clears, so whichever mounted first would consume the parked order and the
 * other would report it missing.
 *
 * On the return leg the store is built as ALREADY SETTLED. That is not a
 * shortcut: the webhook is what settles a hosted payment, and it lands while
 * the buyer is still on the provider's page. The poll below is a real
 * `GET /status` round trip against a real mount; what it finds is what a real
 * server would have.
 */
import type { CheckoutOrder, PaymentFlows } from '@12-apps/payments-frontend';
import { useState, type JSX } from 'react';

import { MountedCheckout, hostedPage } from '../payments/cases';
import { HarnessFlow } from '../payments/host';
import { Panel, PageIntro } from '../payments/panel';
import { WireProbe } from '../payments/probe';
import type { HarnessWorld } from '../payments/store';

/** A chain whose only provider hands the buyer to its own page. */
const REDIRECT_CHAIN = [hostedPage('infinito', ['PIX', 'CARD'])];

/** Whether this page load is a buyer coming back from the provider. */
function isReturnTrip(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('transaction_nsu') || params.has('slug');
}

/** The host's view of the payable it just raised, as the flow's own shape. */
function payableOf(view: {
  invoice: string;
  total: number;
  totalLabel: string;
  hostedCheckoutUrl?: string;
}): CheckoutOrder {
  return {
    orderId: view.invoice,
    status: 'AWAITING_PAYMENT',
    method: 'CARD',
    totalCents: view.total,
    subtotalCents: view.total,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: view.totalLabel,
    ...(view.hostedCheckoutUrl ? { hostedCheckoutUrl: view.hostedCheckoutUrl } : {}),
  };
}

/**
 * Raise a hosted payable over the real wire, then mount the interstitial the
 * host is supposed to show instead of assigning `location` from a hook.
 */
function HandoffLeg({ flows, world }: { flows: PaymentFlows; world: HarnessWorld }): JSX.Element {
  const [payable, setPayable] = useState<CheckoutOrder | null>(null);
  const raise = async (): Promise<void> => {
    const response = await world.createPayable({ method: 'CARD' });
    const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
    if (body?.data) setPayable(payableOf(body.data as Parameters<typeof payableOf>[0]));
  };
  if (!payable) {
    return (
      <button type="button" data-testid="raise-hosted-payable" onClick={() => void raise()}>
        Raise the hosted payable
      </button>
    );
  }
  return (
    <flows.screens.HostedHandoff url={payable.hostedCheckoutUrl ?? ''} payable={payable} />
  );
}

/** The resume leg: rehydrate what was parked and poll it to a terminal state. */
function ReturnLeg({ flows }: { flows: PaymentFlows }): JSX.Element {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <>
      <flows.screens.HostedReturn onResolved={(resolved) => setStatus(resolved)} />
      <p data-testid="hosted-return-status">{status ?? '(polling)'}</p>
    </>
  );
}

export function PaymentsCheckoutRedirectPage(): JSX.Element {
  const returning = isReturnTrip();
  return (
    <>
      <PageIntro title="Checkout · hosted handover (REDIRECT)">
        The whole chain hands the buyer over, so no card form is ever shown. The interstitial
        parks the order before navigating and offers an explicit link; the return trip rehydrates
        the parked order and polls it to PAID.
      </PageIntro>

      {returning ? (
        <Panel id="hosted-return" title="Return leg — rehydrate and poll">
          <HarnessFlow spec={{ chain: REDIRECT_CHAIN, settled: true }}>
            {(flows, world) => (
              <>
                <ReturnLeg flows={flows} />
                <WireProbe world={world} label="hosted-return" />
              </>
            )}
          </HarnessFlow>
        </Panel>
      ) : (
        <>
          <Panel id="hosted-checkout" title="Mounted checkout — no card form is ever offered">
            <MountedCheckout spec={{ chain: REDIRECT_CHAIN }} label="hosted-checkout" />
          </Panel>

          <Panel id="hosted-handoff" title="HostedHandoff — park first, navigate second">
            <HarnessFlow spec={{ chain: REDIRECT_CHAIN }}>
              {(flows, world) => <HandoffLeg flows={flows} world={world} />}
            </HarnessFlow>
          </Panel>
        </>
      )}
    </>
  );
}
