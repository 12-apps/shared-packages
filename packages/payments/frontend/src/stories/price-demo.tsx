/**
 * A HOST that prices each way to pay (FUT-4416) — the stories' stand-in for a
 * store with a discount per payment method. Its figures are the example cart
 * of the ticket: R$ 138,70 at full price, Pix R$ 126,75, cash R$ 134,69, debit
 * R$ 136,03. The package computes none of them: they are the host's, as is
 * every word below.
 */
import { Box } from "@mui/material";
import type { JSX } from "react";

import type { CheckoutDoorOption, CheckoutListChoice, CheckoutListNudge, CheckoutListPrices } from "../index";

/** The cart at full price, in cents. */
export const PRICED_CART_CENTS = 13870;

export const DEMO_PRICES: CheckoutListPrices = {
  online: {
    PIX: { amountLabel: "R$ 126,75", amountCents: 12675, savingLabel: "R$ 11,95", discount: { label: "Desconto no Pix", amountLabel: "−R$ 11,95" } },
    CARD: { amountLabel: "R$ 138,70", amountCents: 13870 },
  },
  wallets: { amountLabel: "R$ 138,70", amountCents: 13870 },
};

/** The door prices, by the demo door's option id. */
const DOOR_PRICES: Record<string, CheckoutDoorOption["price"]> = {
  cash: { amountLabel: "R$ 134,69", savingLabel: "R$ 4,01", discount: { label: "Desconto no dinheiro", amountLabel: "−R$ 4,01" } },
  reader: { amountLabel: "R$ 138,70", upTo: true, note: "Pix R$ 126,75" },
};

/** The demo door, each option priced. */
export function pricedDoor(door: CheckoutDoorOption[]): CheckoutDoorOption[] {
  return door.map((option) => ({ ...option, price: DOOR_PRICES[option.id] }));
}

/** The host's nudges for what is chosen: Pix when a dearer online row is, a note at the door. */
export function demoNudges(choice: CheckoutListChoice | null): CheckoutListNudge[] {
  if (choice?.kind === "online" && choice.method === "CARD") {
    return [{ id: "to-pix", text: "No Pix fica", amountLabel: "R$ 126,75", action: { label: "Pagar com Pix", choose: { method: "PIX" } } }];
  }
  if (choice?.kind === "door" && choice.id === "cash") {
    return [{ id: "door-info", tone: "info", text: "Na porta, outra forma muda o valor: no Pix da maquininha fica R$ 126,75; no débito, R$ 136,03; no crédito, R$ 138,70." }];
  }
  if (choice?.kind === "door" && choice.id === "reader") {
    return [{ id: "door-info", tone: "info", text: "O valor depende do que você passar na maquininha: Pix R$ 126,75 · débito R$ 136,03 · crédito ou vale R$ 138,70." }];
  }
  return [];
}

/** The example cart's lines, as the host words them for "Resumo do pedido". */
export const PRICED_LINES = [
  { key: "margherita", quantity: 1, name: "Pizza Margherita", totalLabel: "R$ 62,00" },
  { key: "burrata", quantity: 1, name: "Burrata com Tomate Assado", totalLabel: "R$ 49,00" },
  { key: "chope", quantity: 2, name: "Chope Pilsen", totalLabel: "R$ 32,00" },
];

/** One of the host's money rows. */
function MoneyRow({ label, amount }: { label: string; amount: string }): JSX.Element {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", typography: "body2", color: "text.secondary" }}>
      <span>{label}</span>
      <span>{amount}</span>
    </Box>
  );
}

/** The host's money rows before the method line: the promotion. */
export function PricedMoneyRows(): JSX.Element {
  return <MoneyRow label="Desconto · Terça da Massa" amount="−R$ 9,30" />;
}

/** The host's money rows after the method line (L24): the delivery fee. */
export function PricedAfterMethodRows(): JSX.Element {
  return <MoneyRow label="Taxa de entrega" amount="R$ 5,00" />;
}
