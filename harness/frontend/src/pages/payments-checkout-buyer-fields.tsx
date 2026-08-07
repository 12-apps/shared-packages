/**
 * What the buyer is asked for, decided by the chain (FUT-743 / FUT-595).
 *
 * The backend has published `customerSchema` per chain entry since FUT-740 and
 * validates every charge against it. The browser used to ignore it and ask for
 * a CPF and nothing else — right for one provider, wrong for a store whose
 * provider wants a mobile, and wrong in the expensive direction: the buyer
 * finishes the form, presses Pagar, and meets a 400 naming a field there was
 * never an input for.
 *
 * Three stores here declare three different things, and the form has to follow
 * each. The fourth case is the refusal itself, taken off the REAL wire and fed
 * back into the REAL form: a charge raised with no CPF answers 400
 * `MISSING_BUYER_FIELD` naming `cpf`, and that name has to land on that exact
 * input rather than as a sentence at the top of the page.
 *
 * The degrade direction is not staged here, and cannot be: no live mount
 * publishes an ABSENT `customerSchema` — a provider that declares nothing
 * publishes `[]`, which genuinely means "ask nothing" (the third case). The
 * absent case belongs to an older host and is covered by the package's own
 * `buyer-fields.test.ts`; staging it here would require lying about the server.
 */
import type { BuyerField, BuyerInfo, PaymentFlows } from '@12-apps/payments-frontend';
import { useState, type JSX } from 'react';

import { HarnessFlow } from '../payments/host';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';
import { WireProbe } from '../payments/probe';
import type { HarnessWorld } from '../payments/store';

/** A store whose only provider asks for exactly one declared thing. */
function storeAsking(schema: { key: 'taxId' | 'phone'; type: 'CPF' | 'MOBILE' }[] | []) {
  return {
    chain: [
      {
        name: 'aurora' as const,
        tokenization: 'PUBLIC_KEY' as const,
        methods: ['CARD' as const],
        publicKey: 'pk_harness_aurora',
        stub: true,
        customerSchema: schema.map((field) => ({ ...field, required: true })),
      },
    ],
  };
}

/** The standalone buyer form, driven by whatever the chain declared. */
function BuyerForm({
  flows,
  error,
}: {
  flows: PaymentFlows;
  error?: { field: 'cpf' | 'email' | 'name' | 'phone'; message: string } | null;
}): JSX.Element {
  const [buyer, setBuyer] = useState<BuyerInfo>({});
  return (
    <flows.screens.BuyerDetails
      value={buyer}
      onChange={setBuyer}
      method="CARD"
      onContinue={() => undefined}
      error={error ?? null}
    />
  );
}

/**
 * The mount's refusal, as it came off the wire.
 *
 * `error` is the buyer's sentence and `code` is the machine name — the envelope
 * the shipped responder writes, read here rather than re-derived, because a
 * page that reshaped it would stop testing the shape.
 */
interface Refusal {
  code: string;
  field: BuyerField | null;
  error: string;
}

/**
 * Charge with no CPF and let the mount refuse, then hand the refusal to the
 * form. Everything below the button is real: the payable is raised over the
 * wire, the charge is the published FLAT body, and the 400 is the shipped
 * failure pipeline's own answer.
 */
function ServerRefusal({ flows, world }: { flows: PaymentFlows; world: HarnessWorld }): JSX.Element {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const charge = async (): Promise<void> => {
    const raised = await world.createPayable({ method: 'CARD' });
    const view = (await raised.json()) as { data?: { invoice?: string } };
    const response = await world.fetchImpl('/api/checkout/charge', {
      method: 'POST',
      body: JSON.stringify({ orderId: view.data?.invoice, token: 'tok_harness', saveCard: false }),
    });
    const body = (await response.json().catch(() => null)) as Partial<Refusal> | null;
    setRefusal({
      code: body?.code ?? '(none)',
      field: body?.field ?? null,
      error: body?.error ?? '',
    });
  };
  return (
    <>
      <button type="button" data-testid="charge-without-cpf" onClick={() => void charge()}>
        Cobrar sem CPF
      </button>
      <p>
        <span data-testid="refusal-code">{refusal?.code ?? '(not yet)'}</span>{' '}
        <span data-testid="refusal-field">{refusal?.field ?? '(none)'}</span>
      </p>
      <BuyerForm
        flows={flows}
        error={refusal?.field ? { field: refusal.field as 'cpf', message: refusal.error } : null}
      />
      <WireProbe world={world} label="missing-field" />
    </>
  );
}

const CASES: HarnessCase[] = [
  {
    id: 'taxid-required',
    label: 'CPF required',
    render: () => (
      <HarnessFlow spec={storeAsking([{ key: 'taxId', type: 'CPF' }])}>
        {(flows) => <BuyerForm flows={flows} />}
      </HarnessFlow>
    ),
  },
  {
    id: 'phone-required',
    label: 'Phone required',
    render: () => (
      <HarnessFlow spec={storeAsking([{ key: 'phone', type: 'MOBILE' }])}>
        {(flows) => <BuyerForm flows={flows} />}
      </HarnessFlow>
    ),
  },
  {
    id: 'nothing-required',
    label: 'Nothing asked',
    render: () => (
      <HarnessFlow spec={storeAsking([])}>{(flows) => <BuyerForm flows={flows} />}</HarnessFlow>
    ),
  },
  {
    id: 'server-refusal',
    label: 'MISSING_BUYER_FIELD',
    render: () => (
      <HarnessFlow spec={storeAsking([{ key: 'taxId', type: 'CPF' }])}>
        {(flows, world) => <ServerRefusal flows={flows} world={world} />}
      </HarnessFlow>
    ),
  },
];

export function PaymentsCheckoutBuyerFieldsPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Checkout · buyer fields from the chain">
        Three stores declaring three different requirements, and the refusal a fourth one answers
        when a charge arrives without the field it named.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
