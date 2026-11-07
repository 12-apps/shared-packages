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
    PIX: { amountLabel: "R$\u00a0126,75", amountCents: 12675, savingLabel: "R$\u00a011,95", discount: { label: "Desconto no Pix", amountLabel: "−R$\u00a011,95" } },
    CARD: { amountLabel: "R$\u00a0138,70", amountCents: 13870 },
  },
  wallets: { amountLabel: "R$\u00a0138,70", amountCents: 13870 },
};

/** The cart's price once the demo buyer's R$ 20,00 store credit is used. */
const AFTER_CREDIT = { amountLabel: "R$\u00a0118,70", amountCents: 11870 };

/**
 * The prices with the store credit used (E28, C23): the credit cancels the
 * method's discount whole, so every online way to pay costs the cart less
 * the credit — no "Desconto no Pix", no saving line.
 */
export const CREDIT_PRICES: CheckoutListPrices = {
  online: {
    PIX: { ...AFTER_CREDIT, note: "Sem o desconto do Pix" },
    CARD: AFTER_CREDIT,
  },
  wallets: AFTER_CREDIT,
};

/** The door prices, by the demo door's option id. */
const DOOR_PRICES: Record<string, CheckoutDoorOption["price"]> = {
  cash: { amountLabel: "R$\u00a0134,69", savingLabel: "R$\u00a04,01", discount: { label: "Desconto no dinheiro", amountLabel: "−R$\u00a04,01" } },
  reader: { amountLabel: "R$\u00a0138,70", upTo: true, note: "Pix R$\u00a0126,75" },
};

/** The demo door, each option priced. */
export function pricedDoor(door: CheckoutDoorOption[]): CheckoutDoorOption[] {
  return door.map((option) => ({ ...option, price: DOOR_PRICES[option.id] }));
}

/** The host's notes at the door, by the demo door's option id. */
const DOOR_NOTES: Record<string, string> = {
  cash: "Na porta, outra forma muda o valor: no Pix da maquininha fica R$\u00a0126,75; no débito, R$\u00a0136,03; no crédito, R$\u00a0138,70.",
  reader: "O valor depende do que você passar na maquininha: Pix R$\u00a0126,75 · débito R$\u00a0136,03 · crédito ou vale R$\u00a0138,70.",
};

/** The store credit as the demo host holds it: whether it is used, and how to drop it. */
interface DemoCredit {
  used: boolean;
  drop: () => void;
}

/** With the credit used, what Pix costs without it (E28); else Pix while the dearer card is chosen. */
function onlineNudges(method: string, credit: DemoCredit): CheckoutListNudge[] {
  if (credit.used) {
    return [{ id: "drop-credit", text: "Sem o crédito, no Pix fica", amountLabel: "R$\u00a0126,75", action: { label: "Não usar crédito", onPress: credit.drop } }];
  }
  if (method !== "CARD") return [];
  return [{ id: "to-pix", text: "No Pix fica", amountLabel: "R$\u00a0126,75", action: { label: "Pagar com Pix", choose: { method: "PIX" } } }];
}

/** The host's nudges for what is chosen: online, as `onlineNudges` says; a note at the door. */
export function demoNudges(choice: CheckoutListChoice | null, credit: DemoCredit = { used: false, drop: () => undefined }): CheckoutListNudge[] {
  if (choice?.kind === "online") return onlineNudges(choice.method, credit);
  const note = choice?.kind === "door" ? DOOR_NOTES[choice.id] : undefined;
  return note ? [{ id: "door-info", tone: "info", text: note }] : [];
}

/** The example cart's lines, as the host words them for "Resumo do pedido". */
export const PRICED_LINES = [
  { key: "margherita", quantity: 1, name: "Pizza Margherita", totalLabel: "R$\u00a062,00" },
  { key: "burrata", quantity: 1, name: "Burrata com Tomate Assado", totalLabel: "R$\u00a049,00" },
  { key: "chope", quantity: 2, name: "Chope Pilsen", totalLabel: "R$\u00a032,00" },
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
  return <MoneyRow label="Desconto · Terça da Massa" amount={"−R$\u00a09,30"} />;
}

/** The host's money rows after the method line (L24): the store credit while it is used, then the delivery fee. */
export function PricedAfterMethodRows({ credit = false }: { credit?: boolean }): JSX.Element {
  return (
    <>
      {credit ? <MoneyRow label="Crédito da loja" amount={"−R$\u00a020,00"} /> : null}
      <MoneyRow label="Taxa de entrega" amount={"R$\u00a05,00"} />
    </>
  );
}

/** "Usar meus R$ 20,00 de crédito na loja" — the host's own control, and what it does to the method's discount. */
export function DemoCreditBox({ used, onChange }: { used: boolean; onChange: (used: boolean) => void }): JSX.Element {
  return (
    <Box component="label" sx={{ display: "flex", alignItems: "flex-start", gap: 1, typography: "body2" }}>
      <input type="checkbox" checked={used} onChange={(event) => onChange(event.target.checked)} data-testid="demo-credit" />
      <Box component="span" sx={{ display: "flex", flexDirection: "column" }}>
        <span>{"Usar meus R$\u00a020,00 de crédito na loja"}</span>
        <Box component="span" sx={{ color: "text.secondary" }}>O desconto da forma de pagamento não vale junto com o crédito.</Box>
      </Box>
    </Box>
  );
}
