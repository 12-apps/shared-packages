import type { Meta, StoryObj } from "@storybook/react-vite";

import { CART_CENTS, ON_FILE, ON_PAGE, SAVED, scene } from "./payment-list-scene";

/**
 * THE ONE LIST'S HARDER STATES (FUT-3591/3592) — each the start of a run the
 * buyer plays from here; the visual gate drives them with the same clicks.
 *
 *  - the Google Pay row, and its charge on Google's own button;
 *  - a Pix the cart moved under ("Adicionar um item"), before and after the
 *    copy — "Atualizar pagamento" takes the bar;
 *  - the host holding the button ("Pausar a loja") over the list or the Pix;
 *  - a raise the host refuses; a card charge nobody can classify;
 *  - a store with door options only; a long payer name.
 *
 * "Adicionar um item" and "Pausar a loja" are the HOST's controls, drawn above
 * the step; they are not part of the package.
 */
const meta: Meta = { title: "Checkout/Pagamento — one list, states" };
export default meta;

const WALLET = { ...ON_PAGE, wallets: ["GOOGLE_PAY" as const], googlePayMerchantId: "MID_LOJA_1" };

/** Google Pay as its own row; chosen, Google's own button takes the bar's place. */
export const GooglePay: StoryObj = scene(
  { chain: [WALLET], amountCents: CART_CENTS.before },
  { taxIdOnFile: true, buyer: ON_FILE },
  { totalCents: CART_CENTS.before, googlePay: true },
);

/** Pix raised, then the cart moves: the face keeps the code, the bar asks to refresh. */
export const StalePix: StoryObj = scene(
  { chain: [ON_PAGE], instruments: SAVED, amountCents: CART_CENTS.before },
  { taxIdOnFile: true, buyer: ON_FILE },
  { controls: true },
);

/** The host holds the button — over the list, or over a raised Pix ("Pausar a loja"). */
export const HostHold: StoryObj = scene(
  { chain: [ON_PAGE], instruments: SAVED, amountCents: CART_CENTS.before },
  { taxIdOnFile: true, buyer: ON_FILE },
  { controls: true },
);

/** The host refuses to raise the payment: the error panel, in the step. */
export const RaiseRefused: StoryObj = scene(
  { chain: [ON_PAGE], instruments: SAVED, amountCents: CART_CENTS.before },
  { taxIdOnFile: true, buyer: ON_FILE, refuseRaise: { code: "UNKNOWN", message: "Não foi possível gerar o pagamento agora." } },
);

/** A card charge the provider cannot classify: the UNRESOLVED words inside the card option. */
export const ChargeUnresolved: StoryObj = scene(
  { chain: [{ ...ON_PAGE, ambiguous: true }], instruments: SAVED, amountCents: CART_CENTS.before },
  { taxIdOnFile: true, buyer: ON_FILE },
);

/** A store that takes nothing online: the door options alone, under no online heading. */
export const DoorOnly: StoryObj = scene(
  { chain: [{ ...ON_PAGE, methods: [] }], amountCents: CART_CENTS.before },
  { taxIdOnFile: true, buyer: ON_FILE },
);

/** A payer whose name does not fit a line: "Alterar" wraps under it, at the left. */
export const LongPayerName: StoryObj = scene(
  { chain: [ON_PAGE], instruments: SAVED, amountCents: CART_CENTS.before },
  { taxIdOnFile: true, buyer: { ...ON_FILE, name: "Maria Aparecida dos Santos Albuquerque de Oliveira Cavalcanti" } },
);
