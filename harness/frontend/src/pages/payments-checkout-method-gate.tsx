/**
 * A CARD charge aimed at a PIX payable, and the refusal it must meet
 * (FUT-743 / FUT-740's first critical).
 *
 * `POST /charge` raises a CARD charge. A payable whose method is PIX is one the
 * buyer is holding a live QR for, so the mount refuses that pairing and answers
 * `PAYABLE_NOT_FOUND` — the same 404 it gives an absent handle and a stranger's,
 * because telling them apart tells a prober which handles exist.
 *
 * It is a MONEY rule, not a validation nicety. Settle a PIX payable with a card
 * and the QR stays scannable and still points at a chargeable code: two payable
 * codes for one payable, the double payment `checkout/reuse.ts` exists to
 * prevent, and one the superseded-code void cannot clean up because it only
 * ever looks at PIX charges priced at some OTHER amount.
 *
 * ## Why this is a page of its own
 *
 * No mounted checkout can produce this request — the published client raises a
 * payable for the method it is about to charge. The pairing arises from a HOST:
 * a buyer whose tab still holds the ref of the PIX payable they abandoned, a
 * retry, a replayed request. So the page is the host, and it posts the charge
 * itself, at the ref the mount just handed it, through the same real transport
 * every other page uses.
 *
 * Nobody has paid the QR (`settlesOnPoll: false`): the payable has to still be
 * OPEN when the card charge arrives, or the refusal under test is the terminal
 * state's, not the method gate's.
 */
import { useState, type JSX } from 'react';

import { mintable } from '../payments/cases';
import { PageIntro } from '../payments/panel';
import { WireProbe } from '../payments/probe';
import { createHarnessStore, type HarnessWorld } from '../payments/store';

/** The store: one provider taking both methods, whose PIX nobody has paid. */
const SPEC = { chain: [mintable('aurora', ['PIX', 'CARD'], { settlesOnPoll: false })] };

/** A CPF that passes the real check-digit rule the provider's gate runs. */
const TAX_ID = '529.982.247-25';

/** The PIX payable the mount raised, as the host read it back. */
interface RaisedPix {
  ref: string;
  code: string;
}

/** The mount's answer to the card charge, as it came off the wire. */
interface Refusal {
  status: number;
  code: string;
}

/** Raise a PIX payable over the real wire and read its ref and payload back. */
async function raisePix(world: HarnessWorld): Promise<RaisedPix> {
  const response = await world.createPayable({ method: 'PIX', buyer: { taxId: TAX_ID } });
  const body = (await response.json().catch(() => null)) as {
    data?: { invoice?: string; pix?: { copyPaste?: string } };
  } | null;
  return { ref: body?.data?.invoice ?? '(none)', code: body?.data?.pix?.copyPaste ?? '(none)' };
}

/**
 * Charge a card against that ref — the published FLAT body, complete.
 *
 * The instrument and the CPF are both present on purpose: every gate the mount
 * runs BEFORE the method one would otherwise answer first, and the page would
 * then prove that a missing field is refused rather than that a PIX payable is.
 */
async function chargeCard(world: HarnessWorld, ref: string): Promise<Refusal> {
  const response = await world.fetchImpl('/api/checkout/charge', {
    method: 'POST',
    body: JSON.stringify({ orderId: ref, token: 'tok_harness_card', saveCard: false, taxId: TAX_ID }),
  });
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  return { status: response.status, code: body?.code ?? '(none)' };
}

/** One labelled fact of the host's own, beside the probe's. */
function Line({ id, value }: { id: string; value: string }): JSX.Element {
  return (
    <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, margin: '6px 0' }}>
      {id} <span data-testid={id}>{value}</span>
    </p>
  );
}

function MethodGate(): JSX.Element {
  // Built once per mount: a store rebuilt on render would forget the payable
  // the buyer is holding, which is the one fact this page is about.
  const [world] = useState<HarnessWorld>(() => createHarnessStore(SPEC));
  const [pix, setPix] = useState<RaisedPix | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  return (
    <>
      <button type="button" data-testid="raise-pix-payable" onClick={() => void raisePix(world).then(setPix)}>
        Gerar o PIX
      </button>{' '}
      <button
        type="button"
        data-testid="charge-card-on-pix"
        disabled={!pix}
        onClick={() => void chargeCard(world, pix?.ref ?? '').then(setRefusal)}
      >
        Cobrar no cartão o mesmo pedido
      </button>

      <Line id="pix-payable-ref" value={pix?.ref ?? '(not yet)'} />
      <Line id="pix-payable-code" value={pix?.code ?? '(not yet)'} />
      <Line id="refusal-status" value={refusal ? String(refusal.status) : '(not yet)'} />
      <Line id="refusal-code" value={refusal?.code ?? '(not yet)'} />

      <WireProbe world={world} label="method-gate" />
    </>
  );
}

export function PaymentsCheckoutMethodGatePage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · a card charge on a PIX payable">
        The mount raises a PIX payable with a live copia-e-cola, and the host then posts a card{' '}
        <code>/charge</code> at that same ref. It is answered <code>PAYABLE_NOT_FOUND</code> and no
        second charge reaches the provider — the QR the buyer is holding stays the only one.
      </PageIntro>
      <MethodGate />
    </>
  );
}
