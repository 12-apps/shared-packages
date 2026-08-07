import type { Meta, StoryObj } from "@storybook/react-vite";

import { StoryFlow, type StoryHost } from "./host";
import type { StorySpec } from "./store";

/**
 * THE WHOLE BUYER CHECKOUT, in one line, against a real mount (FUT-741/742).
 *
 * Each story below is a different STORE — a different chain, a different
 * declaration, a different failure — and the mount reacts to it exactly as a
 * deployed one would. Nothing is faked above the credentials.
 *
 * How to read a story: fill the CPF (`529.982.247-25` passes the check digits),
 * press Continuar, pick a method. The card stories run in the server's stub
 * mode, so `4111 1111 1111 1111` settles and `4000 0000 0000 0002` declines.
 */
const meta: Meta = {
  title: "Checkout/Checkout",
  parameters: {
    docs: {
      description: {
        component:
          "`createPaymentFlows(...).Checkout` — Dados → Pagamento → Confirmação, " +
          "driven against a live `createPaymentFlowsBE` mount running in the page.",
      },
    },
  },
};
export default meta;

/** One story = one store + one host. */
function scene(spec: StorySpec, host: StoryHost = {}): StoryObj {
  return {
    render: () => (
      <StoryFlow spec={spec} host={host}>
        {(flows) => <flows.Checkout />}
      </StoryFlow>
    ),
  };
}

const STUB = { stub: true, publicKey: null } as const;

// ---------------------------------------------------------------------------
// The config read
// ---------------------------------------------------------------------------

/** `/config` has not answered yet. The flow renders; nothing is refused early. */
export const ConfigPending: StoryObj = scene({}, { configRead: "pending" });

/**
 * `/config` failed. The picker fails OPEN — both tiles — and nothing is raised
 * as an error to the buyer, because the server still fails the charge CLOSED.
 * A blip must never hide a working checkout, and must never invent permission
 * to mock a token.
 */
export const ConfigFailed: StoryObj = scene({}, { configRead: "failing" });

// ---------------------------------------------------------------------------
// A store that cannot charge
// ---------------------------------------------------------------------------

/** No provider connected. The method picker never renders at all. */
export const NoProviderConnected: StoryObj = scene({ chain: [] });

/** …and with a remedy the host can offer, the sentence is a different one. */
export const NoProviderWithRemedy: StoryObj = scene(
  { chain: [] },
  {
    availability: {
      payable: true,
      remedy: { label: "Chamar garçom", onSelect: () => undefined },
    },
  },
);

/**
 * A LIVE chain, vetoed by the host: the store can charge and has switched
 * online payments off. `/config` cannot see that, so the veto is OR'd with the
 * chain rather than replaced by it — otherwise this store offers a checkout it
 * will not honour.
 */
export const HostVetoWithLiveChain: StoryObj = scene({}, { availability: { payable: false } });

// ---------------------------------------------------------------------------
// What the chain offers
// ---------------------------------------------------------------------------

/** PIX only: the CARD tile is absent, PIX is taken, no extra tap is demanded. */
export const PixOnly: StoryObj = scene({
  chain: [{ name: "aurora", methods: ["PIX"], ...STUB }],
});

/** Card only: the PIX tile is absent and the card form is reached directly. */
export const CardOnly: StoryObj = scene({
  chain: [{ name: "aurora", methods: ["CARD"], ...STUB }],
});

/** Both. Switching method drops the raised order — no stale QR behind a form. */
export const PixAndCard: StoryObj = scene({
  chain: [{ name: "aurora", methods: ["PIX", "CARD"], ...STUB }],
});

// ---------------------------------------------------------------------------
// Tokenization schemes, decided by the declaration and never by a name
// ---------------------------------------------------------------------------

/**
 * `mockTokenization` granted — the server's stub mode, the ONLY licence to
 * mint a fake token. `4000 0000 0000 0002` declines; anything else settles.
 */
export const StubTokenizationGranted: StoryObj = scene({
  chain: [{ name: "aurora", methods: ["CARD"], ...STUB }],
});

/**
 * `NONE`: the method is offered and no instrument is asked for. Nothing is
 * mocked — the provider simply takes an unattributed charge.
 */
export const TokenizationNone: StoryObj = scene({
  chain: [{ name: "aurora", tokenization: "NONE", methods: ["PIX", "CARD"], ...STUB }],
});

/**
 * `REDIRECT` for the whole chain: no card form is ever shown. The order is
 * raised, parked, and the handoff interstitial takes over — with the explicit
 * link a bare `location.assign` never had.
 */
export const RedirectChain: StoryObj = scene({
  chain: [
    { name: "aurora", tokenization: "REDIRECT", methods: ["PIX", "CARD"], hosted: true, ...STUB },
  ],
});

// ---------------------------------------------------------------------------
// The failover chain (FUT-563)
// ---------------------------------------------------------------------------

/**
 * TWO mintable providers. `tokensByProvider` carries one instrument per entry,
 * the head is unreachable, and the tail settles with nothing re-typed.
 */
export const TwoMintableProviders: StoryObj = scene({
  chain: [
    { name: "aurora", methods: ["CARD"], unreachable: true, ...STUB },
    { name: "boreal", methods: ["CARD"], ...STUB },
  ],
});

/**
 * A REDIRECT head with a mintable tail. The card form IS shown — the question
 * is "can anybody in this chain tokenize", not "can the head" — the bare token
 * is minted from the TAIL, and `tokensByProvider` still travels because the
 * PUBLISHED chain has more than one entry.
 */
export const RedirectHeadMintableTail: StoryObj = scene({
  chain: [
    { name: "aurora", tokenization: "REDIRECT", methods: ["CARD"], ...STUB },
    { name: "boreal", methods: ["CARD"], ...STUB },
  ],
});

// ---------------------------------------------------------------------------
// Failures, each worded for what it actually is
// ---------------------------------------------------------------------------

/** An issuer decline: FAILED, "nenhum valor foi cobrado" first, retry offered. */
export const IssuerDecline: StoryObj = scene({
  chain: [{ name: "aurora", methods: ["CARD"], declines: true, ...STUB }],
});

/**
 * `PAYMENT_UNRESOLVED` (409). Somebody may be holding the buyer's money, so
 * the pay bar is REMOVED rather than disabled and no retry affordance exists
 * anywhere on screen — a live "Pagar R$ …" under "não pague de novo" is what
 * the thumb reaches for.
 */
export const PaymentUnresolved: StoryObj = scene({
  chain: [{ name: "aurora", methods: ["PIX", "CARD"], ambiguous: true, ...STUB }],
});

/**
 * `PAYMENT_UNAVAILABLE` (502) — the chain was exhausted. Worded by METHOD: a
 * card failure still offers PIX.
 */
export const PaymentUnavailable: StoryObj = scene({
  chain: [{ name: "aurora", methods: ["PIX", "CARD"], unreachable: true, ...STUB }],
});

// ---------------------------------------------------------------------------
// What the buyer is asked for (FUT-595)
// ---------------------------------------------------------------------------

/** The chain declares the CPF. Continuar refuses until it is a valid one. */
export const RequiresTaxId: StoryObj = scene({
  chain: [
    {
      name: "aurora",
      ...STUB,
      customerSchema: [{ key: "taxId", type: "CPF", required: true }],
    },
  ],
});

/** The chain declares a PHONE instead — and no CPF field is rendered at all. */
export const RequiresPhone: StoryObj = scene({
  chain: [
    {
      name: "aurora",
      ...STUB,
      customerSchema: [{ key: "phone", type: "MOBILE", required: true }],
    },
  ],
});

/**
 * The chain declares an EMPTY schema — it genuinely asks for nothing, so the
 * form asks for nothing required. Note this is NOT the same as a config with no
 * `customerSchema` field at all, which degrades to CPF-required; a live mount
 * never produces that, so it is pinned in `buyer-fields.test.ts` instead.
 */
export const RequiresNothing: StoryObj = scene({
  chain: [{ name: "aurora", ...STUB, customerSchema: [] }],
});

/**
 * The server refuses with `MISSING_BUYER_FIELD` and names the field. Reached by
 * a chain that requires a CPF the buyer's saved profile supposedly holds — so
 * Dados is skipped, and the 400 arrives with nowhere to have typed it.
 */
export const MissingBuyerFieldFromServer: StoryObj = scene(
  {
    chain: [
      {
        name: "aurora",
        methods: ["PIX"],
        ...STUB,
        customerSchema: [{ key: "taxId", type: "CPF", required: true }],
      },
    ],
  },
  { taxIdOnFile: true },
);

// ---------------------------------------------------------------------------
// Cart, comanda and the returning buyer
// ---------------------------------------------------------------------------

/** Nothing to check out. Cart mode only. */
export const EmptyCartFlow: StoryObj = scene({}, { cart: { empty: true, totalItems: 0 } });

/** A comanda settlement — legitimately an empty cart, with the mesa's total. */
export const ComandaTable: StoryObj = scene(
  {},
  {
    cart: { empty: true, totalItems: 0 },
    comanda: { scope: "TABLE", totalLabel: "R$ 214,00", totalItems: 7 },
  },
);

/** The buyer's own share of a shared comanda. */
export const ComandaMine: StoryObj = scene(
  {},
  {
    cart: { empty: true, totalItems: 0 },
    comanda: { scope: "MINE", totalLabel: "R$ 62,50", totalItems: 3 },
  },
);

/** A host discount line under the pay-bar total — rendered BY the host. */
export const HostDiscountLines: StoryObj = scene(
  {},
  {
    cart: {
      discountLines: (
        <span style={{ fontSize: 12, opacity: 0.75 }}>Cupom BEMVINDO · −R$ 7,50</span>
      ),
    },
  },
);

/**
 * The buyer already has a CPF on file: Dados is skipped, and `PayerSummary`
 * states who is about to be charged with "Alterar" to reopen the form.
 */
export const TaxIdOnFile: StoryObj = scene(
  { chain: [{ name: "aurora", methods: ["PIX", "CARD"], ...STUB }] },
  { taxIdOnFile: true, buyer: { name: "Ana Compradora" } },
);

/** Saved cards to reuse, scoped to this store. */
export const SavedCardsAvailable: StoryObj = scene({
  chain: [{ name: "aurora", methods: ["CARD"], ...STUB }],
  instruments: [
    { id: "card_1", last4: "4242", brand: "visa" },
    { id: "card_2", last4: "0005", brand: "mastercard" },
  ],
});

/**
 * A saved card this store cannot charge (409). It must read as "not usable
 * here — re-enter the card", never as a decline that blames the buyer.
 */
export const SavedCardNotUsableHere: StoryObj = scene({
  chain: [{ name: "aurora", methods: ["CARD"], ...STUB }],
  instruments: [{ id: "card_1", last4: "4242", brand: "visa" }],
  unusableInstruments: ["card_1"],
});

/** Host content under the PAID receipt — the storefront's install invite. */
export const ConfirmationExtra: StoryObj = scene(
  { chain: [{ name: "aurora", methods: ["CARD"], ...STUB }] },
  {
    confirmationExtra: (
      <div style={{ padding: 12, border: "1px dashed #999", borderRadius: 8 }}>
        Instale o app da loja para pedir mais rápido da próxima vez.
      </div>
    ),
  },
);
