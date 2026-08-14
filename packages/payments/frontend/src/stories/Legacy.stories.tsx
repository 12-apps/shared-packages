import { useMemo, useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { ClientChargeView, CustomerInfo, Money } from "@12-apps/payments-backend";

import {
  CheckoutComponentsProvider,
  CheckoutFlow,
  CheckoutPayment,
  createPaymentsClient,
  NEW_CARD,
  PaymentsProvider,
  SavedCardsPicker,
  type BuyerInfo,
  type CardFormValues,
  type CheckoutCopyFE,
  type CheckoutPaymentProps,
  type CheckoutScreens,
  type PaymentFlows,
  type SavedCard,
  type SavedCardOption,
} from "../index";

import { CLIENT_BASE_URL, createClientStoryStore, type ClientStorySpec } from "./client-store";
import { STORY_CHECKOUT_COPY } from "./demo-copy";
import { raisePayable, StoryFlow, withConfigRead, type StoryHost } from "./host";
import type { StoryWorld } from "./store";

/**
 * THE FLAT SURFACE THAT PREDATES THE FACTORY, still exported and still real.
 *
 * `createPaymentFlows` (FUT-741) was additive: `CheckoutFlow` (FUT-564),
 * `CheckoutPayment`, the card primitives and the copy table all stay on
 * `index.ts`, and hosts that composed them by hand keep working. An escape
 * hatch nobody exercises is one that quietly stops working — so each story
 * below mounts one of those exports DIRECTLY, against the same real in-page
 * mounts every other story runs on (`store.ts` for the checkout wire,
 * `client-store.ts` for the older `/charges` wire). Nothing here is padded:
 * where an export's states are already pinned elsewhere, one honest mount is
 * all this file adds.
 */
const meta: Meta = {
  title: "Checkout/Legacy surface",
  parameters: {
    docs: {
      description: {
        component:
          "The pre-factory exports — `CheckoutFlow`, `CheckoutPayment`, `SavedCardsPicker`, " +
          "`STORY_CHECKOUT_COPY` — mounted directly, the way a hand-composing host does, " +
          "against live in-page mounts.",
      },
    },
  },
};
export default meta;

const STUB = { stub: true, publicKey: null } as const;

// ---------------------------------------------------------------------------
// `CheckoutFlow`, mounted by hand
// ---------------------------------------------------------------------------

/**
 * ONE story on purpose: `flows.Checkout` renders this very component, so its
 * 27 states (chains, declines, comandas, saved cards…) are already pinned in
 * `Checkout.stories.tsx`. What is NOT covered there is the direct-mount
 * contract a hand-composing host uses — cart + ports as props, the config
 * fetched by the host and handed in — which is exactly what this pins.
 *
 * The one piece of glue a story adds is `flows.Provider`: a shipped host that
 * mounts `CheckoutFlow` bare gets the ambient-fetch default client, and a
 * story may not touch the network — the Provider is the documented seam for
 * binding the tree to another mount, so it is also the honest one here.
 */
export const CheckoutFlowByHand: StoryObj = {
  name: "CheckoutFlow montado à mão — o contrato de props",
  render: () => (
    <StoryFlow spec={{ chain: [{ name: "aurora", methods: ["PIX", "CARD"], ...STUB }] }}>
      {(flows, world) => (
        <flows.Provider>
          <HandMountedFlow flows={flows} world={world} />
        </flows.Provider>
      )}
    </StoryFlow>
  ),
};

/** The host's half, written out: read the config, wire the ports, mount. */
function HandMountedFlow({
  flows,
  world,
}: {
  flows: PaymentFlows;
  world: StoryWorld;
}): JSX.Element {
  const { config } = flows.useCheckoutConfig();
  return (
    <CheckoutFlow
      cart={{ empty: false, totalLabel: "R$ 75,00", totalItems: 2 }}
      createOrder={(input) => raisePayable(world, input)}
      onExitToMenu={() => undefined}
      providerConfig={config}
      tenantSlug="loja-1"
    />
  );
}

// ---------------------------------------------------------------------------
// `CheckoutPayment` — the older plug-and-play payment step
// ---------------------------------------------------------------------------

/** The display total the host shows; the mount recomputes what is charged. */
const AMOUNT: Money = { amountCents: 7500, currency: "BRL" };

/**
 * The buyer identity the host already holds — CPF included: the story chain
 * declares the Brazilian CPF-required schema, and the MOUNT refuses a charge
 * without one (FUT-595). Collecting it is the host page's job on this legacy
 * surface; `CheckoutPayment` only spends what it is handed.
 */
const BUYER: CustomerInfo = {
  name: "Ana Compradora",
  email: "ana@exemplo.com",
  taxId: "52998224725",
};

/**
 * The host-injected tokenizer port. In production this is the provider's
 * browser SDK; the story's chain runs the server's stub mode, which takes any
 * minted token — so the story mints a deterministic one from the form, which
 * is exactly the shape of glue a real host writes.
 */
async function tokenizeForStory(values: CardFormValues): Promise<string> {
  return `tok_historia_${values.number.replace(/\D/g, "").slice(-4)}`;
}

/**
 * The host glue every `CheckoutPayment` story shares: one store, one bound
 * client, and the host's own reaction to `onPaid`/`onFailed` — the component
 * deliberately owns only the payment interaction, so the confirmation line is
 * the HOST's to draw.
 */
function CheckoutPaymentScene({
  spec,
  savedCards,
  tokenizeCard,
  configRead,
}: {
  spec?: ClientStorySpec;
  savedCards?: SavedCardOption[];
  tokenizeCard?: CheckoutPaymentProps["tokenizeCard"];
  /** `host.tsx`'s config shim, reused: this surface's `/config` stalls the same way. */
  configRead?: StoryHost["configRead"];
}): JSX.Element {
  // Built once per mount (same rule as `host.tsx`): a fresh client identity
  // on every render would re-run the component's config read forever.
  const client = useMemo(
    () =>
      createPaymentsClient({
        baseUrl: CLIENT_BASE_URL,
        fetchImpl: withConfigRead(createClientStoryStore(spec).fetchImpl, configRead),
      }),
    [],
  );
  const [outcome, setOutcome] = useState<ClientChargeView | null>(null);
  return (
    <PaymentsProvider client={client}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {outcome ? (
          <p style={{ fontSize: 14, fontWeight: 600 }}>
            {outcome.status === "PAID"
              ? "Pagamento aprovado — a loja confirmou o pedido."
              : `Pagamento não concluído (${outcome.status}).`}
          </p>
        ) : null}
        <CheckoutPayment
          reference="pedido-0043"
          amount={AMOUNT}
          customer={BUYER}
          tokenizeCard={tokenizeCard}
          savedCards={savedCards}
          onPaid={setOutcome}
          onFailed={setOutcome}
        />
      </div>
    </PaymentsProvider>
  );
}

/**
 * The default store: PIX and card on one provider. "Gerar QR Code PIX" raises
 * a real charge on the in-page mount and shows its copia-e-cola; "Cartão"
 * opens the inline form, and a submitted card settles synchronously — the
 * host banner above the step is `onPaid` firing.
 *
 * The PIX panel's QR IMAGE branch (`charge.pix.qrImageUrl`) stays off screen
 * by construction: the story adapter answers a text payload only, and an
 * image URL would be a network fetch the story world forbids — the copia-e-cola
 * is the branch every state here exercises.
 */
export const CheckoutPaymentPixAndCard: StoryObj = {
  name: "CheckoutPayment — PIX e cartão na mesma loja",
  render: () => <CheckoutPaymentScene tokenizeCard={tokenizeForStory} />,
};

/**
 * Provider-vaulted cards. Pick "Cartão" and the radio list renders — the
 * vaulted cards with "Novo cartão" as the trailing fallback — and one tap on
 * "Pagar R$ 75,00" charges the SAVED token, no tokenizer involved on that
 * path. (The step always opens on its method chooser; the list is one tap in,
 * which is exactly where the shipped storefront shows it.)
 */
export const CheckoutPaymentSavedCards: StoryObj = {
  name: "CheckoutPayment — cartões salvos, um toque",
  render: () => (
    <CheckoutPaymentScene
      tokenizeCard={tokenizeForStory}
      savedCards={[
        { savedCardToken: "vault_cartao_1", brand: "Visa", last4: "4242", expiry: "04/2030" },
        { savedCardToken: "vault_cartao_2", brand: "Mastercard", last4: "0005", expiry: "11/2028" },
      ]}
    />
  ),
};

/**
 * The third advertised flow, REDIRECT (a hosted acquirer): the method chooser
 * never renders — there is nothing to choose on our page — and the step opens
 * on the single "Continuar para o pagamento" button. Drive it: the click
 * raises a real charge on the mount, which answers `hostedCheckoutUrl`, and
 * the step becomes the handover panel — "Você será direcionado…" with the
 * "Pagar R$ 75,00" link. Following THAT link leaves the story iframe for the
 * fictional provider page, disclosed the same way the connect stories disclose
 * their hop; every pinned state is on the near side of it.
 */
export const CheckoutPaymentRedirect: StoryObj = {
  name: "CheckoutPayment — provedor hosted (REDIRECT)",
  render: () => (
    <CheckoutPaymentScene
      spec={{ chain: [{ name: "aurora", tokenization: "REDIRECT", hosted: true, ...STUB }] }}
    />
  ),
};

/**
 * No provider connected: `GET /config` answers `null` and the step says so
 * instead of rendering a chooser it cannot honour.
 */
export const CheckoutPaymentStoreOff: StoryObj = {
  name: "CheckoutPayment — loja sem provedor",
  render: () => <CheckoutPaymentScene spec={{ chain: [] }} />,
};

/**
 * The loading gate (`checkout-payment-loading`): the config read has not
 * answered, so the step shows its spinner and offers nothing — pinned by a
 * `/config` that never settles (`withConfigRead`, the same shim the factory
 * stories use), because a live mount answers too fast to photograph.
 */
export const CheckoutPaymentLoading: StoryObj = {
  name: "CheckoutPayment — o portão de espera",
  render: () => <CheckoutPaymentScene configRead="pending" />,
};

// ---------------------------------------------------------------------------
// `SavedCardsPicker`, mounted directly
// ---------------------------------------------------------------------------

/** Display metadata only — the reusable tokens live server-side, keyed by id. */
const VAULTED_CARDS: SavedCard[] = [
  { id: "cartao_1", brand: "Visa", last4: "4242", expMonth: 4, expYear: 2030, holder: "ANA C SILVA" },
  { id: "cartao_2", brand: "Mastercard", last4: "0005", expMonth: 11, expYear: 2028, holder: "ANA C SILVA" },
];

/**
 * The picker OUTSIDE `screens.CardEntry`, which is how the admin's activation
 * charge reuses it: the host owns the selection, and the trailing option hands
 * back the `NEW_CARD` sentinel rather than a card id.
 */
function SavedCardsPickerHost(): JSX.Element {
  const [selection, setSelection] = useState<string>("cartao_1");
  return (
    <CheckoutComponentsProvider>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SavedCardsPicker savedCards={VAULTED_CARDS} selection={selection} onSelect={setSelection} />
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          {selection === NEW_CARD ? (
            <>
              Sentinela <code>NEW_CARD</code>: aqui o host abriria o formulário de cartão novo.
            </>
          ) : (
            <>
              Selecionado: <code>{selection}</code>
            </>
          )}
        </p>
      </div>
    </CheckoutComponentsProvider>
  );
}

export const SavedCardsPickerDirect: StoryObj = {
  name: "SavedCardsPicker direto — a seleção é do host",
  render: () => <SavedCardsPickerHost />,
};

// ---------------------------------------------------------------------------
// `STORY_CHECKOUT_COPY`, overridden
// ---------------------------------------------------------------------------

/**
 * A host's own sentences — pt-BR replacing pt-BR, because the override seam
 * exists for a store's voice, never for translating the product.
 */
const COPY_DA_CANTINA = {
  unavailableTitle: "Pagamentos em pausa na cantina",
  unavailableBody:
    "Nossa maquininha está em manutenção. Peça no balcão que anotamos seu pedido na hora.",
  continueAction: "Ir para o pagamento",
} satisfies Partial<CheckoutCopyFE>;

/** The buyer form, standalone, so the overridden continue action is on screen. */
function ContinueActionDemo({
  Screen,
}: {
  Screen: CheckoutScreens["BuyerDetails"];
}): JSX.Element {
  const [buyer, setBuyer] = useState<BuyerInfo>({});
  return <Screen value={buyer} onChange={setBuyer} method={null} onContinue={() => undefined} />;
}

/**
 * The same override, visible on the two factory surfaces that own the
 * sentences: the mounted flow's unavailable screen (title and body, left) and
 * the standalone `screens.BuyerDetails`' continue action (right). The caption
 * under each quotes what `STORY_CHECKOUT_COPY` would have said — the
 * export a host reads to know which sentences are the factory's to replace.
 *
 * `copy.ts` scopes the table on purpose: screens that carried their own
 * product copy before the factory (the flow's Dados step, PIX, card, status)
 * keep it, so nothing in this story pretends the override reaches them.
 */
export const CopyOverridden: StoryObj = {
  name: "Copy do host — as frases que a fábrica cede",
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <section>
        <h3 style={{ fontSize: 13, textTransform: "uppercase", opacity: 0.6 }}>
          loja sem provedor — copy do host
        </h3>
        <StoryFlow spec={{ chain: [] }} host={{ copy: COPY_DA_CANTINA }}>
          {(flows) => <flows.Checkout />}
        </StoryFlow>
        <p style={{ fontSize: 11, opacity: 0.6 }}>
          padrão: “{STORY_CHECKOUT_COPY.unavailableTitle}”
        </p>
      </section>
      <section>
        <h3 style={{ fontSize: 13, textTransform: "uppercase", opacity: 0.6 }}>
          formulário de dados — copy do host
        </h3>
        <StoryFlow spec={{}} host={{ copy: COPY_DA_CANTINA }}>
          {(flows) => <ContinueActionDemo Screen={flows.screens.BuyerDetails} />}
        </StoryFlow>
        <p style={{ fontSize: 11, opacity: 0.6 }}>
          padrão: “{STORY_CHECKOUT_COPY.continueAction}”
        </p>
      </section>
    </div>
  ),
};
