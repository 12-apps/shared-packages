import type { Meta, StoryObj } from "@storybook/react-vite";

import { CART_CENTS, ON_FILE, ON_PAGE, SAVED, scene } from "./payment-list-scene";

/**
 * THE WALLETS AND THE CPF AT THE TOP OF THE ONE LIST (FUT-3685, option B).
 *
 * Above the rows: the CPF, asked once for every online way to pay (E1), then
 * "PAGAMENTO RÁPIDO" — the ready wallets' buttons — and "ou escolha como
 * pagar" (C5, C6). No wallet ready, no block (E4); one ready, its button alone
 * (E5). A missing CPF holds the wallets and the online rows with the bar's
 * reason, never a door row (E3, R3). On a computer, "Resumo do pedido" sits
 * beside the step with the pay button (L4).
 *
 * Google's `pay.js` and Safari's `ApplePaySession` are faked per scene — a
 * real browser here has neither — so the buttons are stand-ins for the ones
 * Google and Apple draw.
 */
const meta: Meta = { title: "Checkout/Pagamento — wallets" };
export default meta;

const GOOGLE = { ...ON_PAGE, wallets: ["GOOGLE_PAY" as const], googlePayMerchantId: "MID_LOJA_1" };
const BOTH = { ...ON_PAGE, wallets: ["GOOGLE_PAY" as const, "APPLE_PAY" as const], googlePayMerchantId: "MID_LOJA_1" };
const NEW_BUYER = { taxIdOnFile: false, buyer: { name: "Ana Teste" } };
const RETURNING = { taxIdOnFile: true, buyer: ON_FILE };
const PRICED = { totalCents: CART_CENTS.before };

/** No wallet ready on this device: no heading, no buttons, no divider (E4) — the rows alone. */
export const NoWallet: StoryObj = scene({ chain: [BOTH], instruments: SAVED, amountCents: CART_CENTS.before }, RETURNING, PRICED);

/** Google Pay only: its button alone, full width (E5). */
export const GoogleOnly: StoryObj = scene({ chain: [GOOGLE], instruments: SAVED, amountCents: CART_CENTS.before }, RETURNING, { ...PRICED, googlePay: true });

/** Both wallets: Google and Apple, stacked on a phone (L3). */
export const BothWallets: StoryObj = scene(
  { chain: [BOTH], instruments: SAVED, amountCents: CART_CENTS.before },
  RETURNING,
  { ...PRICED, googlePay: true, applePay: true },
);

/**
 * A new buyer: the CPF at the top, the provider's reason under it; the wallets and
 * the online rows' button held with "Digite seu CPF ou CNPJ para pagar pelo app." —
 * a door row still sends (E1, E3, R3).
 */
export const CpfMissing: StoryObj = scene(
  { chain: [BOTH], amountCents: CART_CENTS.before },
  NEW_BUYER,
  { ...PRICED, googlePay: true, applePay: true },
);

/** A CPF on file: no field, the payer line — "Alterar" opens the CPF at the top (E2). */
export const CpfOnFile: StoryObj = scene(
  { chain: [BOTH], instruments: SAVED, amountCents: CART_CENTS.before },
  RETURNING,
  { ...PRICED, googlePay: true, applePay: true },
);

/** Store credit pays R$ 5,00: the sheets and the button ask for the amount due, R$ 22,00 (E11, K3). */
export const StoreCredit: StoryObj = scene(
  { chain: [BOTH], instruments: SAVED, amountCents: CART_CENTS.before },
  RETURNING,
  { totalCents: 2200, amountDueLabel: "R$ 22,00", googlePay: true, applePay: true },
);

/** The computer: wallets side by side (L5), the CPF field narrow (L7), "Resumo do pedido" with the button (L4). */
export const Desktop: StoryObj = scene(
  { chain: [BOTH], amountCents: CART_CENTS.before },
  NEW_BUYER,
  { ...PRICED, googlePay: true, applePay: true, desktop: true },
);

/** The computer, a returning buyer with a saved card: the pay button lives in the column, no bar. */
export const DesktopReturning: StoryObj = scene(
  { chain: [BOTH], instruments: SAVED, amountCents: CART_CENTS.before },
  RETURNING,
  { ...PRICED, googlePay: true, applePay: true, desktop: true },
);
