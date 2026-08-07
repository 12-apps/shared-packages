import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { CheckoutScreens, PaymentFlows } from "../flows/types";
import type { BuyerInfo, CheckoutOrder, OrderStatus, PaymentMethod } from "../index";

import { StoryFlow, type StoryHost } from "./host";
import type { StorySpec } from "./store";

/**
 * The screens ON THEIR OWN (FUT-741/742).
 *
 * `createPaymentFlows` returns eleven of them, and the claim being reviewed
 * here is that each one works STANDALONE — mounted with no `Provider` above it,
 * no props threaded from a parent flow, and no host glue beyond its own. Every
 * story below mounts exactly one, straight out of `flows.screens`.
 */
const meta: Meta = {
  title: "Checkout/Screens",
  parameters: {
    docs: {
      description: {
        component:
          "Each `screens.*` member, mounted alone. They fetch `/config` themselves " +
          "when no `Provider` sits above them, which is what makes the Provider an " +
          "optimisation rather than a precondition.",
      },
    },
  },
};
export default meta;

const STUB = { stub: true, publicKey: null } as const;

/** A payable the screen-level stories are handed, as a host would build one. */
const PAYABLE: CheckoutOrder = {
  orderId: "inv_2026_0043",
  status: "AWAITING_PAYMENT",
  method: "PIX",
  totalCents: 7500,
  subtotalCents: 7500,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 75,00",
  pix: {
    copyPaste:
      "00020126580014BR.GOV.BCB.PIX0136inv_2026_00435204000053039865802BR6009SAO PAULO62070503***6304ABCD",
    expiresAt: "2026-08-07T23:59:00.000Z",
  },
};

/** Mount one screen alone, with whatever store and host it needs. */
function screen(
  spec: StorySpec,
  render: (flows: PaymentFlows) => JSX.Element,
  host: StoryHost = {},
): StoryObj {
  return {
    render: () => (
      <StoryFlow spec={spec} host={host}>
        {(flows) => render(flows)}
      </StoryFlow>
    ),
  };
}

// ---------------------------------------------------------------------------
// MethodChoice
// ---------------------------------------------------------------------------

/** Both methods offered; the tiles are real focusable radios. */
export const MethodChoiceBoth: StoryObj = screen(
  { chain: [{ name: "aurora", methods: ["PIX", "CARD"], ...STUB }] },
  (flows) => <MethodChoiceDemo Screen={flows.screens.MethodChoice} />,
);

/** PIX-only: one tile, and it is taken rather than demanded. */
export const MethodChoicePixOnly: StoryObj = screen(
  { chain: [{ name: "aurora", methods: ["PIX"], ...STUB }] },
  (flows) => <MethodChoiceDemo Screen={flows.screens.MethodChoice} />,
);

/**
 * A chain that declares CARD but gives this browser no way to mint for it: the
 * tile is DISABLED with a caption saying so, rather than silently vanishing
 * into an unexplained one-option "choice".
 */
export const MethodChoiceCardUnmintable: StoryObj = screen(
  {
    chain: [
      { name: "aurora", methods: ["PIX", "CARD"], tokenization: "PUBLIC_KEY", publicKey: null },
    ],
  },
  (flows) => <MethodChoiceDemo Screen={flows.screens.MethodChoice} />,
);

function MethodChoiceDemo({ Screen }: { Screen: CheckoutScreens["MethodChoice"] }): JSX.Element {
  const [value, setValue] = useState<PaymentMethod | null>(null);
  return (
    <>
      <Screen value={value} onChange={setValue} />
      <p style={{ opacity: 0.6, fontSize: 12 }}>escolhido: {value ?? "—"}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// BuyerDetails — fields derived from the chain's declaration (FUT-595)
// ---------------------------------------------------------------------------

function BuyerDetailsDemo({
  Screen,
  method,
  error,
}: {
  Screen: CheckoutScreens["BuyerDetails"];
  method: PaymentMethod | null;
  error?: { field: "cpf" | "email" | "name" | "phone"; message: string } | null;
}): JSX.Element {
  const [buyer, setBuyer] = useState<BuyerInfo>({});
  return (
    <Screen
      value={buyer}
      onChange={setBuyer}
      method={method}
      error={error}
      onContinue={() => undefined}
    />
  );
}

/** The chain asks for a CPF. */
export const BuyerDetailsTaxId: StoryObj = screen(
  {
    chain: [
      { name: "aurora", ...STUB, customerSchema: [{ key: "taxId", type: "CPF", required: true }] },
    ],
  },
  (flows) => <BuyerDetailsDemo Screen={flows.screens.BuyerDetails} method="CARD" />,
);

/** The chain asks for a MOBILE — and never mentions a CPF. */
export const BuyerDetailsPhone: StoryObj = screen(
  {
    chain: [
      {
        name: "aurora",
        ...STUB,
        customerSchema: [{ key: "phone", type: "MOBILE", required: true }],
      },
    ],
  },
  (flows) => <BuyerDetailsDemo Screen={flows.screens.BuyerDetails} method="CARD" />,
);

/** The chain asks for nothing required; the receipt fields stay optional. */
export const BuyerDetailsNothingRequired: StoryObj = screen(
  { chain: [{ name: "aurora", ...STUB, customerSchema: [] }] },
  (flows) => <BuyerDetailsDemo Screen={flows.screens.BuyerDetails} method="CARD" />,
);

/**
 * Different requirements per METHOD. Switch the story's `method` and the form
 * changes with it — one flat required/optional flag cannot express this.
 */
export const BuyerDetailsPerMethod: StoryObj = screen(
  {
    chain: [
      {
        name: "aurora",
        ...STUB,
        customerSchema: [
          { key: "taxId", type: "CPF", required: true, methods: ["PIX"] },
          { key: "email", type: "EMAIL", required: true, methods: ["CARD"] },
        ],
      },
    ],
  },
  (flows) => <BuyerDetailsDemo Screen={flows.screens.BuyerDetails} method="PIX" />,
);

/** A server 400 echoed onto the exact input it named. */
export const BuyerDetailsServerRefusal: StoryObj = screen(
  {
    chain: [
      { name: "aurora", ...STUB, customerSchema: [{ key: "taxId", type: "CPF", required: true }] },
    ],
  },
  (flows) => (
    <BuyerDetailsDemo
      Screen={flows.screens.BuyerDetails}
      method="CARD"
      error={{ field: "cpf", message: "Informe: taxId." }}
    />
  ),
);

// ---------------------------------------------------------------------------
// PixPayment / CardEntry / PaymentStatus
// ---------------------------------------------------------------------------

/** The QR, the copy strip, the expiry and the live poll footer. */
export const PixPaymentLive: StoryObj = screen(
  { chain: [{ name: "aurora", methods: ["PIX"], ...STUB }] },
  (flows) => <flows.screens.PixPayment payable={PAYABLE} onResolved={() => undefined} />,
);

/** The card form: saved-card picker (empty here), new card, pay bar. */
export const CardEntryNewCard: StoryObj = screen(
  { chain: [{ name: "aurora", methods: ["CARD"], ...STUB }] },
  (flows) => (
    <flows.screens.CardEntry
      payable={{ ...PAYABLE, method: "CARD", pix: undefined }}
      onResolved={() => undefined}
    />
  ),
);

/** With instruments to reuse, scoped to this store. */
export const CardEntryWithSavedCards: StoryObj = screen(
  {
    chain: [{ name: "aurora", methods: ["CARD"], ...STUB }],
    instruments: [
      { id: "card_1", last4: "4242", brand: "visa" },
      { id: "card_2", last4: "0005", brand: "mastercard" },
    ],
  },
  (flows) => (
    <flows.screens.CardEntry
      payable={{ ...PAYABLE, method: "CARD", pix: undefined }}
      onResolved={() => undefined}
    />
  ),
);

const statusStory = (status: OrderStatus): StoryObj =>
  screen({}, (flows) => (
    <flows.screens.PaymentStatus status={status} payable={{ ...PAYABLE, status }} />
  ));

/** The receipt: amount, quotable reference, where the e-mail went. */
export const StatusPaid: StoryObj = statusStory("PAID");
/** "Nenhum valor foi cobrado" is said FIRST, then the retry. */
export const StatusFailed: StoryObj = statusStory("FAILED");
/** The code lapsed; the action is to generate a new one. */
export const StatusExpired: StoryObj = statusStory("EXPIRED");
/** Still confirming — a bounded wait, not an infinite spinner. */
export const StatusAwaiting: StoryObj = statusStory("AWAITING_PAYMENT");

// ---------------------------------------------------------------------------
// PaymentsUnavailable / PayerSummary / SavedCards / EmptyCart
// ---------------------------------------------------------------------------

/** No remedy: say plainly that this store does not charge online. */
export const UnavailableNoRemedy: StoryObj = screen({ chain: [] }, (flows) => (
  <flows.screens.PaymentsUnavailable />
));

/** A remedy exists: offer it instead of an apology. */
export const UnavailableWithRemedy: StoryObj = screen(
  { chain: [] },
  (flows) => <flows.screens.PaymentsUnavailable />,
  {
    availability: {
      payable: true,
      remedy: { label: "Chamar garçom", onSelect: () => undefined },
    },
  },
);

/** "Pagando como …", with Alterar to reopen the form. */
export const PayerSummaryWithEdit: StoryObj = screen({}, (flows) => (
  <flows.screens.PayerSummary
    buyer={{ name: "Ana Compradora", taxId: "52998224725" }}
    onEdit={() => undefined}
  />
));

/** The saved CPF is never shown, because the client never receives it. */
export const PayerSummarySavedTaxId: StoryObj = screen({}, (flows) => (
  <flows.screens.PayerSummary buyer={{ name: "Ana Compradora" }} onEdit={() => undefined} />
));

/** A list to pick from. */
export const SavedCardsList: StoryObj = screen(
  {
    chain: [{ name: "aurora", methods: ["CARD"], ...STUB }],
    instruments: [
      { id: "card_1", last4: "4242", brand: "visa" },
      { id: "card_2", last4: "0005", brand: "mastercard" },
    ],
  },
  (flows) => <SavedCardsDemo Screen={flows.screens.SavedCards} />,
);

/** Empty: renders NOTHING — a heading over a void helps nobody. */
export const SavedCardsEmpty: StoryObj = screen(
  { chain: [{ name: "aurora", methods: ["CARD"], ...STUB }] },
  (flows) => (
    <>
      <SavedCardsDemo Screen={flows.screens.SavedCards} />
      <p style={{ opacity: 0.6, fontSize: 12 }}>(nada acima desta linha — é o estado vazio)</p>
    </>
  ),
);

function SavedCardsDemo({ Screen }: { Screen: CheckoutScreens["SavedCards"] }): JSX.Element {
  const [selection, setSelection] = useState("new");
  return <Screen selection={selection} onSelect={setSelection} />;
}

/** Nothing to check out. */
export const EmptyCartScreen: StoryObj = screen({}, (flows) => <flows.screens.EmptyCart />);
