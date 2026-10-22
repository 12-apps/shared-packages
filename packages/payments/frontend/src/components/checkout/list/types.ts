/**
 * The Pagamento step as ONE list (FUT-3591): every way to pay — the ones the
 * store charges through this package AND the host's own ways to pay at the
 * door — as one radio group under two headings, with one bar whose button is
 * the only thing that creates the order and the charge.
 *
 * Opt-in, through `CheckoutFlowProps.paymentList`. A host that passes nothing
 * keeps the method tabs, the order summary and the raise-on-pick it has today — this is additive.
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

import type { PaymentListCredit, PaymentListCreditCopy, PaymentListSummary } from "./credit-types";
import type { CheckoutBillingAddress, PaymentListDebitCopy } from "./debit-copy";

export type { CheckoutBillingAddress, PaymentListDebitCopy };

/**
 * What a door option's `content` function is handed (FUT-3715).
 *
 * `choose` is exactly what the row's radio does; calling it on the chosen row
 * changes nothing. The list reports the choice through `onChoiceChange` as it
 * does for the radio — from an effect, after the render — so a host that
 * answers in the same tap keeps its answer across that render. The list never
 * moves keyboard focus here: where focus goes is the host's call.
 */
export interface CheckoutDoorRowControls {
  /** This option is the list's current choice. */
  chosen: boolean;
  /** Choose this option, as its radio would. */
  choose: () => void;
}

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
   * tender chips, the brand lines). Rendered only while chosen — unless
   * `showContentWhileIdle` — with no left indent: it starts where the row's own
   * content starts.
   *
   * As a function it is handed the row's own controls, so a control inside the
   * content can choose the row in the same tap that answers it (the troco
   * chips, FUT-3715). A plain node behaves exactly as before. The function is
   * called during the row's render, not mounted as a component: keep it one
   * shape for the option's life, and return a component of your own if the
   * content needs hooks.
   */
  content?: ReactNode | ((row: CheckoutDoorRowControls) => ReactNode);
  /**
   * Render `content` while the option is NOT chosen too — for an option whose
   * answers are themselves the way to choose it (FUT-3715). The unchosen row
   * keeps its unchosen frame; the content keeps its box and place in both
   * states, so choosing the row moves nothing.
   */
  showContentWhileIdle?: boolean;
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

/**
 * The online ways to pay the list may offer, as the host is told about them.
 * `"GOOGLE_PAY"` is never reported any more: the wallets are buttons above the
 * list, not rows (FUT-3685). It stays in the union so a host's exhaustive
 * switch still compiles.
 */
export type CheckoutOnlineChoice = "PIX" | "CARD" | "GOOGLE_PAY" | "HAND_OFF";

/** What the buyer has chosen in the list. */
export type CheckoutListChoice =
  | { kind: "online"; method: CheckoutOnlineChoice; funding?: "DEBIT" }
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
export interface CheckoutPaymentList extends PaymentListCredit, PaymentListSummary {
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
   * (store credit). It is what the wallets' sheets are priced with (FUT-3685),
   * since a sheet must open INSIDE the tap, before any order exists to read a
   * price from. Never given, or zero (a balance covers everything) ⇒ no wallet
   * buttons. Once given, a moment without it (the host re-pricing) keeps their
   * place, held — plainly, with `copy.reasons.repricing` — until it returns. A
   * key is refused if the order raised behind the sheet asks the provider for
   * another amount (`CheckoutOrder.amountDueCents`, else its total) — so a host
   * that takes a balance off the charge MUST answer `amountDueCents`.
   */
  totalCents?: number;
  /**
   * The same amount, pre-formatted by the host ("R$ 22,00"), when it is not
   * the cart's total — a balance the host holds pays part of it. The card's
   * button, the 5-second bar and Google Pay's press name THIS while an online
   * option is chosen; a door option and an empty choice keep the cart's total,
   * since no balance pays at the door. Absent ⇒ the cart's total. It is also
   * the amount the Pix face asks for.
   *
   * **A balance that covers everything** (`totalCents: 0`): the card option
   * asks for no card, the bar says `copy.chargingCovered`, and the order the
   * button raises must come back SETTLED by the host — paid from the balance,
   * with no provider call — so the list goes to its paid screen. An order that
   * comes back `AWAITING_PAYMENT` with `amountDueCents: 0` is never charged:
   * the list returns to its rows.
   */
  amountDueLabel?: string;
  /**
   * The buyer's last ONLINE way to pay, as the host remembers it (FUT-3611) —
   * chosen for them before they touch anything, when the store offers it: Pix
   * as Pix; a card as the saved card used last. Absent or `null` ⇒ the saved
   * card rule alone. A door tender is never chosen for the buyer.
   */
  lastMethod?: "PIX" | "CARD" | null;
  /**
   * "Pedir em 1 toque" opened this checkout (FUT-3611): the tap on the
   * cardápio was the buyer's consent, so the card's 5-second bar starts by
   * itself once the saved card is chosen and nothing holds the button — ONCE
   * per step, and only within {@link ARMED_WINDOW_MS} of the step opening: a
   * checkout that lands held (a field to fill) never charges by itself minutes
   * later. Without a saved card it does nothing.
   */
  armedCharge?: boolean;
  /**
   * The saved card the host's consent named (the 1-tap offer's). Given, the
   * armed charge fires only on THAT card; a different selection never charges
   * by itself.
   */
  armedCardId?: string;
  /**
   * Host content under the 5-second bar's Cancelar while it counts — the
   * storefront's "Cancelar e desativar a compra em 1 toque". It is handed the
   * bar's own cancel, so a link there stops the charge before doing its own.
   */
  chargeFooter?: (cancel: () => void) => ReactNode;
  /**
   * Pix straight to the buyer's bank app (FUT-3612) — on a phone only: the
   * button generates AND copies the code, a short message says so through
   * `notify`, and the after-copy face offers the six banks (or opens the one
   * remembered). Absent ⇒ today's Pix: "Gerar Pix", then a tap to copy.
   */
  pixBank?: CheckoutPixBank;
  /** Says a short sentence in the host's own toast — "Código Pix copiado". */
  notify?: (message: string) => void;
  /**
   * The host lays out the computer's two columns itself (FUT-3685, L4): its
   * step cards on the left, and this element on the right — the list portals
   * the "Resumo do pedido" column into it (the lines, the money rows, "Total",
   * `summary`, the extras and the pay button), so no bar is drawn at the
   * bottom. `null` while the element is not mounted yet: the bar waits rather
   * than flash. Leave it OUT (undefined) on a phone, or to keep the list's own
   * layout — the step and the column side by side once the flow's frame is
   * wide, the bar otherwise. The Pix screen and the hand-off keep their bar.
   */
  summaryTarget?: HTMLElement | null;
  /** The billing address a DEBIT card's 3-D Secure needs (FUT-3754); none ⇒ no debit row. */
  billingAddress?: CheckoutBillingAddress | null;
}

/** The six banks the Pix face offers to open, in the prototype's order. */
export type PixBankId = "nubank" | "itau" | "bradesco" | "bb" | "caixa" | "santander";

/** `CheckoutPaymentList.pixBank`. */
export interface CheckoutPixBank {
  /** The bank the buyer picked last time, as the host stored it — or `null`. */
  remembered: PixBankId | null;
  /** A bank was picked: the host remembers it for next time (a new pick replaces it). */
  onPick: (bank: PixBankId) => void;
  /** The words; ship with the list's pack (`PIX_BANK_COPY`). */
  copy: PixBankCopy;
  /**
   * Whether this device can open a bank app — a phone. Absent ⇒ read from the
   * browser (Android or iOS). A computer keeps today's face and gets only the
   * generate-and-copy.
   */
  phone?: boolean;
}

/** A bank's name and the article pt-BR puts before it ("o Nubank", "a Caixa"). */
export interface PixBankName {
  name: string;
  /** "Abrir o Nubank" / "Abrir a Caixa" — the article with its trailing space, or "" for none. */
  the: string;
}

export interface PixBankCopy {
  names: Record<PixBankId, PixBankName>;
  /** The bar's button with no bank remembered — "Gerar e copiar o Pix". */
  generateAndCopy: string;
  /** With one remembered — "Gerar, copiar e abrir o Nubank". */
  generateCopyAndOpen: (bank: PixBankName) => string;
  /** The before-copy face's button with one remembered — "Copiar e abrir o Nubank". */
  copyAndOpen: (bank: PixBankName) => string;
  /** The link under the button — "Abrir outro banco". */
  openOther: string;
  /** Over the grid — "Abra seu banco e cole em Pix copia e cola". */
  listTitle: string;
  /** A bank button's accessible name — "Abrir Nubank". */
  open: (bank: PixBankName) => string;
  /** "Abrindo o **Nubank**…" — `**` marks the bold span. */
  opening: (bank: PixBankName) => string;
  /** "Outro banco". */
  other: string;
  /** "Não conseguimos abrir o Nubank. O app está instalado neste celular?" */
  notOpened: (bank: PixBankName) => string;
  /** "Tentar de novo". */
  retry: string;
  /**
   * The one line under the bank being opened, in place of the checklist —
   * "Abra o app do seu banco e cole em Pix copia e cola." Absent ⇒ no line.
   */
  appHint?: string;
  /** The toasts. */
  copied: string;
  copiedPick: string;
  copiedOpening: (bank: PixBankName) => string;
}

/** The list's words — a pack per locale ships at `@12-apps/payments-frontend/locales`. */
export interface PaymentListCopy extends PaymentListCreditCopy {
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
  /** The DEBIT card row's words (FUT-3754). A pack without them offers no debit row. */
  debit?: PaymentListDebitCopy;
  /**
   * @deprecated Google Pay is no longer a row (FUT-3685): it is a button in
   * the "PAGAMENTO RÁPIDO" block — see {@link PaymentListCopy.wallets}. Kept so
   * a host's own pack still type-checks; nothing draws it.
   */
  googlePay: { label: string; hint: string };
  /**
   * The "PAGAMENTO RÁPIDO" block above the list (FUT-3685, T5–T8): the wallet
   * buttons' accessible names and the words around them.
   */
  wallets: {
    /** "Pagamento rápido" — drawn in capitals by CSS. */
    heading: string;
    /** "Pagar com Google Pay". */
    googlePay: string;
    /** "Pagar com Apple Pay". */
    applePay: string;
    /** "ou escolha como pagar" — the divider between the wallets and the rows. */
    or: string;
  };
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
    /**
     * The line under "CPF" at the top of Pagamento (FUT-3685, T3) — "o PagBank
     * pede para pagar pelo app"; `null` when no name was published.
     */
    cpfHint: (provider: string | null) => string;
    /**
     * The link under the CPF opened by "Alterar" over a CPF on file, closing it
     * again — "Manter o CPF salvo" (FUT-3685). Both packs carry it; absent ⇒ no
     * link (an empty field keeps the saved CPF either way).
     */
    keepSavedCpf?: string;
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
    /** Google Pay is chosen while the host re-prices (`totalCents` briefly absent). Absent ⇒ no sentence. */
    repricing?: string;
  };
  /** The button's verb, beside the total. */
  actions: {
    choose: string;
    card: string;
    pix: string;
    googlePay: string;
    /** The bar's verb when the host's balance pays the whole amount. */
    covered: string;
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
