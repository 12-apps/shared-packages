/**
 * The escape hatch, exercised (FUT-743).
 *
 * `createPaymentFlows` made mounting a checkout one line, and the risk of any
 * such factory is that the FLAT exports it was built on quietly stop working —
 * nobody drives them any more, so nothing notices. They are not a legacy
 * surface: a host that wants its own pixels, its own steps or its own order of
 * questions composes them by hand, and the origin host's storefront did exactly that
 * until FUT-741.
 *
 * So this page uses NO factory. It reaches only for what `.` exports and writes
 * the glue itself:
 *
 *   - `createCheckoutClient({ fetchImpl })` — the bound transport, pointed at
 *     the same real `createPaymentFlowsBE` mount every other page uses;
 *   - `buyerFieldsFor(chain, method)` — what this chain says it needs, resolved
 *     for the method actually being paid;
 *   - `tokenizeForCheckout` — the browser-side mint, called directly;
 *   - `NewCardForm` / `CardPayBar` — the shipped card primitives, standing
 *     alone under nothing but their own raw-MUI defaults.
 *
 * The charge goes out through the same client as everywhere else, so the wire
 * probe's body is comparable with the mounted pages': if the factory ever
 * started sending something the flat client does not, the two pages disagree.
 */
import {
  CardPayBar,
  CheckoutCopyProvider,
  NewCardForm,
  buyerFieldsFor,
  createCheckoutClient,
  detectBrand,
  tokenizeForCheckout,
  type CardDetails,
  type CardFieldErrors,
  type CheckoutProviderConfig,
} from '@12-apps/payments-frontend';
import { useEffect, useState, type JSX } from 'react';

import { PageIntro } from '../payments/panel';
import { WireProbe } from '../payments/probe';
import { createHarnessStore, type HarnessWorld } from '../payments/store';
import { HARNESS_CHECKOUT_COPY } from '../payments/checkout-copy';

const CHAIN = [
  {
    name: 'aurora' as const,
    tokenization: 'PUBLIC_KEY' as const,
    methods: ['CARD' as const],
    publicKey: 'pk_harness_aurora',
    stub: true,
  },
];

const EMPTY_CARD: CardDetails = { number: '', holder: '', expiry: '', cvv: '' };
const TAX_ID = '529.982.247-25';

/** Everything one hand-composed checkout holds. */
interface HandRolled {
  config: CheckoutProviderConfig | null;
  card: CardDetails;
  fieldErrors: CardFieldErrors;
  outcome: string | null;
}

/** The store's protocol, read through the flat client. */
function useProtocol(client: ReturnType<typeof createCheckoutClient>): CheckoutProviderConfig | null {
  const [config, setConfig] = useState<CheckoutProviderConfig | null>(null);
  useEffect(() => {
    let active = true;
    void client.getConfig('loja-harness').then((result) => {
      if (active && result.ok) setConfig(result.data);
    });
    return () => {
      active = false;
    };
  }, [client]);
  return config;
}

/** Mint an instrument for the chain head, in the browser, by hand. */
async function mintForHead(
  config: CheckoutProviderConfig,
  card: CardDetails,
): Promise<{ ok: true; token: string } | { ok: false; why: string }> {
  const head = config.chain?.[0];
  const minted = await tokenizeForCheckout(
    card,
    {
      provider: head?.provider ?? null,
      publicKey: head?.publicKey ?? null,
      mockTokenization: head?.mockTokenization ?? false,
    },
    // Composing by hand means supplying the words by hand too: the mint's
    // refusals are this host's sentences (FUT-760).
    HARNESS_CHECKOUT_COPY.views.screens.card,
  );
  return minted.ok ? { ok: true, token: minted.data.token } : { ok: false, why: minted.error };
}

/** Raise the payable, mint an instrument, charge it — the host's own order. */
async function payByHand(
  world: HarnessWorld,
  client: ReturnType<typeof createCheckoutClient>,
  config: CheckoutProviderConfig,
  card: CardDetails,
): Promise<string> {
  const raised = await world.createPayable({ method: 'CARD', buyer: { taxId: TAX_ID } });
  const view = (await raised.json()) as { data?: { invoice?: string } };
  const orderId = view.data?.invoice;
  if (!orderId) return 'NO_PAYABLE';

  const minted = await mintForHead(config, card);
  if (!minted.ok) return `MINT_FAILED: ${minted.why}`;

  const charged = await client.charge({
    orderId,
    token: minted.token,
    saveCard: false,
    taxId: TAX_ID,
  });
  return charged.ok ? charged.data.status : `${charged.code ?? 'REFUSED'}: ${charged.error}`;
}

export function PaymentsCheckoutHeadlessPage(): JSX.Element {
  const [world] = useState(() => createHarnessStore({ chain: CHAIN }));
  const [client] = useState(() => createCheckoutClient({ fetchImpl: world.fetchImpl }));
  const [state, setState] = useState<HandRolled>({
    config: null,
    card: EMPTY_CARD,
    fieldErrors: {},
    outcome: null,
  });
  const config = useProtocol(client);

  const pay = async (): Promise<void> => {
    if (!config) return;
    const outcome = await payByHand(world, client, config, state.card);
    setState((current) => ({ ...current, outcome }));
  };

  const required = buyerFieldsFor(config?.chain, 'CARD')
    .map((field) => field.key)
    .join(',');

  return (
    // No factory above this page, so the card primitives' copy provider is
    // this host's to open — the same line `FlowsShell` would have written.
    <CheckoutCopyProvider copy={HARNESS_CHECKOUT_COPY.views.screens}>
      <PageIntro title="Checkout · composed by hand (no factory)">
        The flat exports only: the bound fetch client, the chain-derived buyer fields, the
        tokenizer and the card primitives. Same mount, same wire, no{' '}
        <code>createPaymentFlows</code> anywhere on this page.
      </PageIntro>

      <p data-testid="headless-chain">{config ? (config.chain ?? []).map((l) => l.provider).join(',') : '(loading)'}</p>
      <p data-testid="headless-required-fields">{config ? required || '(none)' : '(loading)'}</p>

      <NewCardForm
        card={state.card}
        fieldErrors={state.fieldErrors}
        brand={detectBrand(state.card.number)}
        saveCard={false}
        setCard={(next) =>
          setState((current) => ({
            ...current,
            card: typeof next === 'function' ? next(current.card) : next,
          }))
        }
        setFieldErrors={(next) =>
          setState((current) => ({
            ...current,
            fieldErrors: typeof next === 'function' ? next(current.fieldErrors) : next,
          }))
        }
      />
      <CardPayBar totalLabel="R$ 75,00" submitting={false} onPay={() => void pay()} />

      <p data-testid="headless-outcome">{state.outcome ?? '(not paid)'}</p>
      <WireProbe world={world} label="headless" />
    </CheckoutCopyProvider>
  );
}
