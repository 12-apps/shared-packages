import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { CheckoutScreens, PaymentFlows, PaymentStatusScreenProps } from "../flows/types";
import type { CheckoutOrder, OrderStatus } from "../index";

import { StoryFlow, type StoryHost } from "./host";
import type { StorySpec } from "./store";

/**
 * The screens ON THEIR OWN (FUT-741/742).
 *
 * `createPaymentFlows` returns thirteen of them, and the claim being reviewed
 * here is that each one works STANDALONE — mounted with no `Provider` above it,
 * no props threaded from a parent flow, and no host glue beyond its own. Every
 * story below mounts exactly one, straight out of `flows.screens` — except the
 * vault pair (FUT-183), which has its own module, `Vault.stories.tsx`.
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
/**
 * PAID with the host's own illustration in place of the icon — the storefront's
 * mascot on a buyer's first order. The heading and the receipt stay the package's.
 */
export const StatusPaidWithHostHero: StoryObj = screen(
  {},
  (flows) => <flows.screens.PaymentStatus status="PAID" payable={{ ...PAYABLE, status: "PAID" }} />,
  {
    confirmationHero: (
      <span
        style={{ display: "grid", placeItems: "center", width: 112, height: 112, borderRadius: "50%", background: "#F9E2C6", fontSize: 48 }}
        role="img"
        aria-label="Host mascot"
      >
        ★
      </span>
    ),
  },
);

// ---------------------------------------------------------------------------
// The money facts on a settled screen (FUT-612, option C)
// ---------------------------------------------------------------------------

/** The contract's figures: a 2070 pedido, 690 arrived by Pix. */
const SHORT = { totalCents: 2070, paidCents: 690, dueCents: 1380, paidMethod: "PIX", resolution: null } as const;

type ShortFacts = Pick<PaymentStatusScreenProps, "shortfall" | "stockGone">;

const factStory = (status: OrderStatus, facts: ShortFacts): StoryObj =>
  screen({}, (flows) => (
    <flows.screens.PaymentStatus
      status={status}
      payable={{ ...PAYABLE, status, totalCents: 2070, totalLabel: "R$ 20,70" }}
      onPayDifference={() => undefined}
      onRequestRefund={() => undefined}
      {...facts}
    />
  ));

/** A short capture: what is missing, the receipt, pay the difference or cancel and get it back. */
export const StatusShort: StoryObj = factStory("FAILED", { shortfall: SHORT });
/** A person moved the total under the capture: nothing to pay, the store is checking. */
export const StatusShortReviewing: StoryObj = factStory("FAILED", { shortfall: { ...SHORT, dueCents: 0 } });
/** The capture went back. */
export const StatusShortRefunded: StoryObj = factStory("FAILED", { shortfall: { ...SHORT, resolution: "REFUNDED" } });
/** A refund on its way, or waiting for the store ("Estorno pendente"). */
export const StatusShortRefundPending: StoryObj = factStory("FAILED", {
  shortfall: { ...SHORT, resolution: "REFUND_PENDING" },
});
/** The store collected the difference itself and confirmed. */
export const StatusShortSettled: StoryObj = factStory("PAID", { shortfall: { ...SHORT, resolution: "SETTLED" } });
/** The whole amount arrived and an item ran out: its own notice, no action. */
export const StatusStockGone: StoryObj = factStory("FAILED", {
  stockGone: { receivedCents: 2070, missing: ["Pão de queijo"] },
});

// ---------------------------------------------------------------------------
// PaymentsUnavailable / SavedCards / EmptyCart
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
