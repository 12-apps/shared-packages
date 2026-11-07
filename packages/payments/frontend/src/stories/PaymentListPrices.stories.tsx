import type { Meta, StoryObj } from "@storybook/react-vite";

import { ON_FILE, ON_PAGE, SAVED, scene } from "./payment-list-scene";
import { PRICED_CART_CENTS } from "./price-demo";

/**
 * THE ONE LIST WITH A PRICE PER WAY TO PAY (FUT-4416) — the host prices each
 * row (the ticket's example cart: Pix R$ 126,75, card R$ 138,70, cash
 * R$ 134,69, the card machine "até R$ 138,70"), and the list draws it:
 *
 *  - each row's amount at its right, with what it saves under it;
 *  - the chosen row's amount on the button, its discount line in the bar (a
 *    phone) or in "Resumo do pedido" (a computer), "A pagar" / "A pagar na
 *    entrega" under the rule;
 *  - the host's nudge ("No Pix fica R$ 126,75 · Pagar com Pix") while the card
 *    is chosen, and its note at the door;
 *  - Google Pay at the wallets' own price, on its sheet and in the bar;
 *  - the store credit, which cancels the method's discount whole (E28, C23):
 *    every online row at the cart less the credit, and "Não usar crédito".
 *
 * Every figure and sentence is the demo host's; the package computes none.
 */
const meta: Meta = { title: "Checkout/Pagamento — one list, priced per way to pay" };
export default meta;

const SPEC = { chain: [ON_PAGE], instruments: SAVED, amountCents: PRICED_CART_CENTS };
const GOOGLE = { ...ON_PAGE, wallets: ["GOOGLE_PAY" as const], googlePayMerchantId: "MID_LOJA_1" };
const HOST = { taxIdOnFile: true, buyer: ON_FILE };

/** Pix remembered: chosen from the first paint, with its amount and its discount line. */
export const PixRemembered: StoryObj = scene(SPEC, HOST, { totalCents: 12675, priced: true, lastMethod: "PIX" });

/** The card remembered: its plain amount, and the nudge to Pix in the bar. */
export const CardWithNudge: StoryObj = scene(SPEC, HOST, { totalCents: 13870, priced: true, lastMethod: "CARD" });

/** The computer: the rows in two columns, "Resumo do pedido" with the method's line and "A pagar". */
export const PixDesktop: StoryObj = scene(SPEC, HOST, { totalCents: 12675, priced: true, lastMethod: "PIX", desktop: true });

/** The card on the computer: the nudge after "A pagar", before the button. */
export const CardDesktop: StoryObj = scene(SPEC, HOST, { totalCents: 13870, priced: true, lastMethod: "CARD", desktop: true });

/**
 * Google Pay with the rows priced: Pix stays chosen at R$ 126,75, and the
 * wallet's press opens its sheet at the wallets' own price, R$ 138,70 — the
 * amount the bar then names while the charge goes out.
 */
export const GooglePayPriced: StoryObj = scene({ ...SPEC, chain: [GOOGLE] }, HOST, { totalCents: 12675, priced: true, lastMethod: "PIX", googlePay: true });

/**
 * The store credit ticked (E28, C23): it cancels the method's discount, so Pix
 * and the card both cost R$ 118,70 with no "Desconto no Pix", "Crédito da
 * loja" sits in the bar, and the nudge offers the discount back — "Sem o
 * crédito, no Pix fica R$ 126,75 · Não usar crédito".
 */
export const StoreCreditCancelsDiscount: StoryObj = scene(SPEC, HOST, { totalCents: 12675, priced: true, lastMethod: "PIX", credit: true });
