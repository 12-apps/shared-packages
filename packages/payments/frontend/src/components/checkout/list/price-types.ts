import type { ReactNode } from "react";

/**
 * What each way to pay COSTS, as the host prices it (FUT-4416) — a store may
 * charge less for Pix or cash than for a card.
 *
 * The list computes no price: the host does, and hands each way to pay its
 * amount, already formatted. The list draws it at the row's right, names the
 * CHOSEN one on the button, in the 5-second bar and under the rule of "Resumo
 * do pedido", and opens the wallets' sheets at the wallets' price. Every order
 * it raises says which price it is for (`CreateOrderRequest.pricedAs`), and a
 * card order that does not ask the chosen row's cents is never charged.
 *
 * Every field is optional, and a list handed none of them is exactly the list
 * before them: no amount on any row, "Total" and the cart's total.
 */

/** The price of one way to pay — an online row, a door option. */
export interface CheckoutChoicePrice {
  /** What paying this way costs, formatted by the host — "R$ 126,75". */
  amountLabel: string;
  /**
   * The same amount in integer cents. On an ONLINE row it is what the order
   * the host raises for it (`pricedAs` names the row) MUST ask the provider
   * for — `amountDueCents`, else its total: a card order asking anything else
   * is not charged, and a held one is reused only while it asks this. A value
   * that is not a whole, non-negative number is ignored. A door option's is
   * never read: nothing is charged here.
   */
  amountCents?: number;
  /** What this way saves against the full price, formatted — "R$ 11,95", drawn "R$ 11,95 a menos". */
  savingLabel?: string;
  /** A line of the host's own under the amount, in place of the saving — "Pix R$ 126,75". */
  note?: string;
  /** The amount is a ceiling, decided by what is passed later (a card machine): drawn "até R$ 138,70". */
  upTo?: boolean;
  /**
   * The way to pay's own discount, in the host's words — `{ label: "Desconto
   * no Pix", amountLabel: "−R$ 11,95" }` — drawn while it is chosen, after the
   * host's money rows: in "Resumo do pedido", and in the bar on a phone.
   */
  discount?: { label: string; amountLabel: string };
}

/** An online row, as prices are keyed: the debit card row is `CARD_DEBIT`. */
export type CheckoutOnlineRowId = "PIX" | "CARD" | "CARD_DEBIT" | "HAND_OFF";

/**
 * Which price an order is raised for (`CreateOrderRequest.pricedAs`): an
 * online row's, or `WALLET` — a Google Pay or Apple Pay sheet, whatever row is
 * chosen. Sent only by a list the host priced (`CheckoutPaymentList.prices`).
 */
export type CheckoutPricedAs = CheckoutOnlineRowId | "WALLET";

/** The wallets' price (Google Pay, Apple Pay) — the cents their sheets open at. */
export interface CheckoutWalletPrice {
  amountLabel: string;
  amountCents: number;
}

/** `CheckoutPaymentList.prices`. */
export interface CheckoutListPrices {
  /** Each online row's price. A row with none draws no amount; a price for a row not offered is ignored. */
  online?: Partial<Record<CheckoutOnlineRowId, CheckoutChoicePrice>>;
  /**
   * The wallets' price, in place of `totalCents` and `amountDueLabel` for
   * their sheets and their press. The order raised behind a sheet must ask
   * this amount. Unusable cents ⇒ `totalCents`, as before.
   */
  wallets?: CheckoutWalletPrice;
}

/** What a nudge's link does: choose an ONLINE row, or the host's own act. */
export type CheckoutListNudgeAction =
  | {
      /** "Pagar com Pix". */
      label: string;
      /** The row the link chooses. A door option is never chosen for the buyer, so it cannot be named. */
      choose: { method: Exclude<CheckoutOnlineRowId, "CARD_DEBIT">; funding?: "DEBIT" };
    }
  | {
      /** "Não usar crédito". */
      label: string;
      onPress: () => void;
    };

/**
 * A sentence of the host's in the bar and in "Resumo do pedido", before the
 * button — "No Pix fica **R$ 126,75**  Pagar com Pix". A `nudge` is a tinted
 * strip with an optional link; an `info` is a neutral bordered note.
 */
export interface CheckoutListNudge {
  /** Stable within the list; the test id is `list-nudge-<id>`. */
  id: string;
  /** "No Pix fica". */
  text: string;
  /** Drawn bold after the text — "R$ 126,75". */
  amountLabel?: string;
  /** Absent ⇒ `nudge`. */
  tone?: "nudge" | "info";
  /**
   * The link. A `choose` link is drawn only while its row is offered and not
   * already chosen, so a host rebuilding its nudges a render late never
   * offers the row the buyer is on.
   */
  action?: CheckoutListNudgeAction;
}

/** The pricing half of `CheckoutPaymentList`. */
export interface PaymentListPricing {
  prices?: CheckoutListPrices;
  /**
   * The host's money rows that come AFTER the chosen way to pay's discount
   * line in "Resumo do pedido" — the store credit, the delivery fee — so it
   * reads items → promotion → method → credit → fee (L24). `cart.discountLines`
   * stays before the method line. Absent ⇒ every money row before it.
   */
  afterMethodLines?: ReactNode;
  /** Drawn while nothing is being charged: the nudges, then the notes, each in the order given. */
  nudges?: readonly CheckoutListNudge[];
}

/** The pricing half of `CheckoutDoorOption`. */
export interface CheckoutDoorPrice {
  /**
   * This option's price: its amount at the row's right, and while chosen the
   * button's amount (unless `totalLabel`), the discount line and "A pagar na
   * entrega" in "Resumo do pedido".
   */
  price?: CheckoutChoicePrice;
}

/** The amounts' words. Absent ⇒ no saving line, "até" drawn as the plain amount, and "Total" under the rule. */
export interface PaymentListAmountsCopy {
  amounts?: {
    /** "R$ 11,95 a menos". */
    less: (amount: string) => string;
    /** "até R$ 138,70". */
    upTo: (amount: string) => string;
    /** "A pagar" — under the rule while a priced online row is chosen. */
    due: string;
    /** "A pagar na entrega" — under the rule while a priced door option is chosen. */
    dueAtDoor: string;
  };
}
