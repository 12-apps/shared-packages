/**
 * The list face's facts (FUT-3591, FUT-4416): what it reads, and what the bar
 * says for the current choice — kept apart from `./list-face.tsx` for its length.
 */
import type { CheckoutBasketIdentity } from "../basket";
import type { BuyerContact, CheckoutProviderConfig } from "../types";
import type { useCheckoutController } from "../use-checkout-controller";

import { actionLabel } from "./choice";
import { chosenPrice, priceText } from "./choice-price";
import { pixBankLabel } from "./list-memory";
import type { ListCapability } from "./use-capability";
import type { ListCharge } from "./use-list-charge";
import type { ListState } from "./use-list-state";
import type { CheckoutDoorOption, CheckoutPaymentList } from "./types";

type Controller = ReturnType<typeof useCheckoutController>;

/** Everything the list face reads, gathered by the step. */
export interface ListFaceProps {
  c: Controller;
  list: CheckoutPaymentList;
  state: ListState;
  charge: ListCharge;
  cap: ListCapability;
  config: CheckoutProviderConfig | null;
  /** The amount the buyer sees now — the cart's, or the balance's. Never a held order's. */
  total: string;
  provider: string | null;
  taxIdOnFile: boolean;
  /** Which document is on file, when the host knows (FUT-4080); a document typed now wins. */
  taxIdKindOnFile: "CPF" | "CNPJ" | null;
  tenantSlug: string | undefined;
  basket: CheckoutBasketIdentity | undefined;
  pollIntervalMs: number;
  saveBuyerContact?: (contact: BuyerContact) => void;
  /** The hand-off was started: the step shows where the buyer is going. */
  onHandOff: () => void;
  /** "Alterar" on the payer line opened the document (CPF or CNPJ) at the top (E2 → E1). */
  revealed: boolean;
  onRevealCpf: () => void;
  /** "Manter o documento salvo": close the revealed field, keeping the document on file. */
  onKeepSavedCpf: () => void;
}

export function chosenDoor(props: ListFaceProps): CheckoutDoorOption | undefined {
  const { choice } = props.state;
  if (choice?.kind !== "door") return undefined;
  return props.list.door?.find((option) => option.id === choice.id);
}

/** Something is on its way that a second press would duplicate: a raise, a host send, a charge. */
export function inFlight(props: ListFaceProps): boolean {
  const doorPending = props.list.door?.some((option) => option.pending) ?? false;
  return props.c.creating || doorPending || props.charge.phase !== "idle";
}

/**
 * What an online payment asks for: the chosen row's own price (FUT-4416), else
 * the host's amount due when a balance pays part, else the cart's total (P3).
 */
export function onlineTotal(props: ListFaceProps): string {
  const { choice } = props.state;
  const price = choice?.kind === "online" ? chosenPrice(props.list, choice) : undefined;
  return price ? priceText(props.list.copy, price) : unpricedTotal(props);
}

/** What an online payment names with no price of its own — the wallets' fallback. */
export function unpricedTotal(props: ListFaceProps): string {
  return props.list.amountDueLabel ?? props.total;
}

/** A door option's amount: the host's `totalLabel`, else its price (FUT-4416), else the cart's total. */
function doorTotal(props: ListFaceProps, door: CheckoutDoorOption): string {
  return door.totalLabel ?? (door.price ? priceText(props.list.copy, door.price) : props.total);
}

/** The host's balance pays the whole amount (`totalCents: 0`): no card is asked for or charged. */
export function coveredByHost(list: CheckoutPaymentList): boolean {
  return list.totalCents === 0;
}

/** The verb, the amount (none while nothing is chosen) and the busy state of the button, for what is chosen. */
export function buttonFacts(props: ListFaceProps): { label: string; total: string | null; busy: boolean } {
  const { list, state } = props;
  const door = chosenDoor(props);
  const online = state.choice?.kind === "online";
  return {
    label: list.hold ? list.hold.action : pixBankLabel(list, state) ?? actionLabel(list.copy, state.choice, door, props.provider, coveredByHost(list)),
    // A button held with nothing chosen charges nothing: no amount, so its words get the whole width.
    total: door ? doorTotal(props, door) : online ? onlineTotal(props) : state.choice ? props.total : null,
    busy: inFlight(props),
  };
}
