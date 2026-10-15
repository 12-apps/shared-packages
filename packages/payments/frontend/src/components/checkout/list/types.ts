/**
 * The Pagamento step as ONE list (FUT-3591): every way to pay — the ones the
 * store charges through this package AND the host's own ways to pay at the
 * door — as one radio group under two headings, with one bar whose button is
 * the only thing that creates the order and the charge.
 *
 * Opt-in, through `CheckoutFlowProps.paymentList`. A host that passes nothing
 * keeps the method tabs, the order summary and the raise-on-pick it has today
 * — this is additive, not a replacement.
 *
 * ## The door options are the HOST's
 *
 * Paying at the door raises no charge, so nothing about it belongs to a
 * payments package: which tenders a store takes, the troco question, the
 * minimum order and the request that places the pedido are all the host's.
 * The list only DRAWS them — a radio row in the same group, the host's
 * content opened inside it, and the host's verb, reason and send on the bar's
 * button while it is the chosen one. That is the slot `CheckoutDoorOption`
 * describes.
 */
import type { ReactNode } from "react";

/**
 * One of the host's ways to pay at the door — "Dinheiro", "Maquininha".
 *
 * Every field is a fact the host already holds; the list never computes one.
 * Rebuild the array whenever any of them changes (a hook that returns it is the
 * natural shape): the list renders what it is handed on every render.
 */
export interface CheckoutDoorOption {
  /** Stable within the list; reported back through `onChoiceChange`. */
  id: string;
  /** The row's label — "Dinheiro". */
  label: string;
  /** The muted line under the label — "Crédito, débito, vale-refeição ou Pix". */
  hint?: string;
  /**
   * Hide the hint while the option is chosen — for an option whose opened
   * content says the same thing at length (the maquininha's brand lines).
   */
  hideHintWhileChosen?: boolean;
  /**
   * What opens INSIDE the row when it is chosen (the troco question, the
   * tender chips, the brand lines). Rendered only while chosen, with no left
   * indent: it starts where the row's own content starts.
   */
  content?: ReactNode;
  /** The bar button's verb while this option is chosen — "Enviar pedido". */
  action: string;
  /** The amount beside the verb. Absent ⇒ the cart's own total. */
  totalLabel?: string;
  /**
   * Why the button cannot send yet, in the host's words — or `null` when it
   * can. Shown under the button, which stays disabled while it is set.
   */
  blocked: string | null;
  /** The host's send is in flight: the button shows its busy state. */
  pending?: boolean;
  /** A refusal of the last send, in the host's words, shown under the button. */
  error?: string | null;
  /** Press of the bar's button while this option is chosen. Places the order. */
  onSend: () => void;
}

/** The online ways to pay the list may offer, as the host is told about them. */
export type CheckoutOnlineChoice = "PIX" | "CARD" | "GOOGLE_PAY" | "HAND_OFF";

/** What the buyer has chosen in the list. */
export type CheckoutListChoice =
  | { kind: "online"; method: CheckoutOnlineChoice }
  | { kind: "door"; id: string };

/**
 * A reason the HOST is holding the button, whatever is chosen — a step before
 * this one is still open ("Escolha o horário no passo 2."). The button reads
 * `action`, disabled, with `reason` under it.
 */
export interface CheckoutListHold {
  action: string;
  reason: string;
}

/** `CheckoutFlowProps.paymentList` — see the module comment. */
export interface CheckoutPaymentList {
  /** Every sentence the list draws. REQUIRED, with no default (FUT-760). */
  copy: PaymentListCopy;
  /**
   * The first line of the bar, in the host's words — "2 itens · Taxa de
   * entrega R$ 5,00". The list draws it as given.
   */
  summary?: ReactNode;
  /**
   * Host content drawn in the bar while an ONLINE option is chosen, under the
   * summary — the storefront's "Usar meus R$ 5,00 de crédito na loja". A door
   * option hides it: what it offers applies only to a payment made here.
   */
  onlineExtras?: ReactNode;
  /** The "PAGAR NA ENTREGA" group. Absent or empty ⇒ no heading, no rows. */
  door?: readonly CheckoutDoorOption[];
  /** Held by the host — see {@link CheckoutListHold}. */
  hold?: CheckoutListHold | null;
  /** Told whenever the chosen option changes, including to nothing. */
  onChoiceChange?: (choice: CheckoutListChoice | null) => void;
  /**
   * The amount an ONLINE payment will ask the provider for, in integer cents —
   * the cart's total, or what is left of it after a balance the host holds
   * (store credit). It is what Google Pay's sheet is priced with, since that
   * sheet must open INSIDE the tap, before any order exists to read a price
   * from. Absent, or zero (a balance covers everything) ⇒ no Google Pay row,
   * and a Google Pay choice is dropped. The key is refused if the order raised
   * behind the sheet asks the provider for another amount
   * (`CheckoutOrder.amountDueCents`, else its total).
   */
  totalCents?: number;
  /**
   * The same amount, pre-formatted by the host ("R$ 22,00"), when it is not
   * the cart's total — a balance the host holds pays part of it. The card's
   * button, the 5-second bar and Google Pay's press name THIS while an online
   * option is chosen; a door option and an empty choice keep the cart's total,
   * since no balance pays at the door. Absent ⇒ the cart's total. With
   * `totalCents` at zero the bar names no card: `copy.chargingCovered`.
   */
  amountDueLabel?: string;
}

/** The list's words — a pack per locale ships at `@12-apps/payments-frontend/locales`. */
export interface PaymentListCopy {
  /** "Como você quer pagar?" */
  title: string;
  /** "Pagar agora, pelo app" — drawn in capitals by CSS. */
  onlineHeading: string;
  /** "Pagar na entrega" — drawn in capitals by CSS. */
  doorHeading: string;
  pix: { label: string; hint: string };
  card: {
    label: string;
    /** "Visa final 4242 ou outro cartão" — the preselected saved card named. */
    hintSaved: (card: string) => string;
    /** "Digite os dados do cartão". */
    hintNew: string;
  };
  googlePay: { label: string; hint: string };
  handOff: {
    label: string;
    /** "Você paga na página da InfinitePay e volta" — `null` when the store published no name. */
    hint: (provider: string | null) => string;
  };
  /** "Visa final 4242"; `brand` is `null` when the network is unknown ("Cartão final 4242"). */
  savedCard: (brand: string | null, last4: string) => string;
  /** "Outro cartão". */
  otherCard: string;
  /** The buyer's own details asked inside the option, when the store needs one the buyer has not given. */
  buyer: {
    cpf: string;
    phone: string;
    name: string;
    email: string;
    /** "(o PagBank pede para pagar pelo app)" — `null` when no name was published. */
    why: (provider: string | null) => string;
    cpfIncomplete: string;
    phoneIncomplete: string;
  };
  /** Why the button is disabled — shown under it. */
  reasons: {
    choose: string;
    cpf: string;
    phone: string;
    details: string;
    chooseCard: string;
    cardDetails: string;
  };
  /** The button's verb, beside the total. */
  actions: {
    choose: string;
    card: string;
    pix: string;
    googlePay: string;
    handOff: (provider: string | null) => string;
  };
  /** "Pagando como Ana Teste · CPF ✓". */
  payer: (name: string) => string;
  payerChange: string;
  /** The 5-second bar: "Pagando R$ 27,00 no Visa final 4242…"; `card` is `null` for a card typed now. */
  charging: (total: string, card: string | null) => string;
  /**
   * The 5-second bar when the host's balance pays the WHOLE amount
   * (`totalCents` 0), so no card is charged and none is named — "Confirmando
   * o pedido, pago com o seu saldo…". Absent ⇒ `charging` as usual.
   */
  chargingCovered?: string;
  cancel: string;
  pixFace: {
    /** "Pague R$ 22,00 com Pix". */
    title: (total: string) => string;
    /** "Válido até 18:42. Copie o código e cole no app do seu banco, em Pix copia e cola." */
    validUntil: (time: string) => string;
    showQr: string;
    hideQr: string;
    changeMethod: string;
    /** The bar's action, and the accessible name of the tappable code. */
    copyCode: string;
    waiting: string;
  };
  /** "Aguardando a InfinitePay…" */
  handOffWaiting: (provider: string | null) => string;
}
