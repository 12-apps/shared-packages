/**
 * Reading the host's prices (FUT-4416, `./price-types.ts`): which price a row
 * or the current choice carries, how it is worded, and which nudges are drawn.
 * Pure — no React — so every rule here is tested on its own terms.
 */
import type { OnlineRow } from "./choice";
import type { CheckoutChoicePrice, CheckoutListNudge, CheckoutOnlineRowId, CheckoutPricedAs } from "./price-types";
import type { CheckoutListChoice, CheckoutOnlineChoice, CheckoutPaymentList, PaymentListCopy } from "./types";

/** An online row, or choice, as prices are keyed; `null` for one that is never priced (the retired Google Pay row). */
function onlineRowId(row: { method: CheckoutOnlineChoice; funding?: "DEBIT" }): CheckoutOnlineRowId | null {
  if (row.method === "GOOGLE_PAY") return null;
  return row.method === "CARD" && row.funding === "DEBIT" ? "CARD_DEBIT" : row.method;
}

/** The host's price for one online row, if it gave one. */
export function onlinePrice(list: Pick<CheckoutPaymentList, "prices">, row: { method: CheckoutOnlineChoice; funding?: "DEBIT" }): CheckoutChoicePrice | undefined {
  const id = onlineRowId(row);
  return id ? list.prices?.online?.[id] : undefined;
}

/** The price of what is chosen — an online row's, or a door option's — if the host gave one. */
export function chosenPrice(list: Pick<CheckoutPaymentList, "prices" | "door">, choice: CheckoutListChoice | null): CheckoutChoicePrice | undefined {
  if (!choice) return undefined;
  if (choice.kind === "online") return onlinePrice(list, choice);
  return list.door?.find((option) => option.id === choice.id)?.price;
}

/** Cents the list may ask a provider for: a whole number, not below zero. Anything else is ignored. */
function usableCents(cents: number | undefined): number | undefined {
  return cents !== undefined && Number.isInteger(cents) && cents >= 0 ? cents : undefined;
}

/** What the chosen ONLINE row asks the provider for under its own price — `undefined` for a door choice or no price. */
export function chosenOnlineCents(list: Pick<CheckoutPaymentList, "prices">, choice: CheckoutListChoice | null): number | undefined {
  return choice?.kind === "online" ? usableCents(onlinePrice(list, choice)?.amountCents) : undefined;
}

/** The wallets' own cents, when the host priced them usably. */
export function walletOwnCents(list: Pick<CheckoutPaymentList, "prices">): number | undefined {
  return usableCents(list.prices?.wallets?.amountCents);
}

/** What the wallets' sheets open at: their own price, else the host's `totalCents`, as before. */
export function walletCents(list: Pick<CheckoutPaymentList, "prices" | "totalCents">): number | undefined {
  return walletOwnCents(list) ?? list.totalCents;
}

/** The wallets' press names their own price, else what an online payment names without one. */
export function walletTotal(list: Pick<CheckoutPaymentList, "prices">, fallback: string): string {
  const price = list.prices?.wallets;
  return price && walletOwnCents(list) !== undefined ? price.amountLabel : fallback;
}

/** "R$ 126,75", or "até R$ 138,70" — plain when the pack has no word for it. */
export function priceText(copy: PaymentListCopy, price: CheckoutChoicePrice): string {
  return price.upTo && copy.amounts ? copy.amounts.upTo(price.amountLabel) : price.amountLabel;
}

/** The line under the amount: the host's note, else "R$ 11,95 a menos" when the pack words it, else none. */
function priceNote(copy: PaymentListCopy, price: CheckoutChoicePrice): string | null {
  if (price.note) return price.note;
  return price.savingLabel && copy.amounts ? copy.amounts.less(price.savingLabel) : null;
}

/**
 * The words under the rule of "Resumo do pedido" for a priced choice — "A
 * pagar" or "A pagar na entrega" — or `undefined` to keep "Total".
 */
function dueTitle(copy: PaymentListCopy, choice: CheckoutListChoice | null): string | undefined {
  if (!copy.amounts || !choice) return undefined;
  return choice.kind === "door" ? copy.amounts.dueAtDoor : copy.amounts.due;
}

/** Whether a nudge's `choose` names the chosen row. */
function choosesCurrent(nudge: CheckoutListNudge, choice: CheckoutListChoice | null): boolean {
  if (!nudge.action || !("choose" in nudge.action) || choice?.kind !== "online") return false;
  const { method, funding } = nudge.action.choose;
  return choice.method === method && choice.funding === funding;
}

/** Whether a nudge's `choose` names a row the list offers and can choose. */
function choosesOffered(nudge: CheckoutListNudge, rows: readonly OnlineRow[]): boolean {
  if (!nudge.action || !("choose" in nudge.action)) return true;
  const { method, funding } = nudge.action.choose;
  return rows.some((row) => !row.disabled && row.method === method && row.funding === funding);
}

/** The nudges to draw: a `choose` link only while its row is offered and is not the one chosen. */
export function shownNudges(nudges: readonly CheckoutListNudge[] | undefined, rows: readonly OnlineRow[], choice: CheckoutListChoice | null): CheckoutListNudge[] {
  return (nudges ?? []).filter((nudge) => choosesOffered(nudge, rows) && !choosesCurrent(nudge, choice));
}

/** A row's amount as `OptionRow` draws it, or `null` for a row the host did not price. */
export function rowAmount(copy: PaymentListCopy, price: CheckoutChoicePrice | undefined): { text: string; note: string | null } | null {
  return price ? { text: priceText(copy, price), note: priceNote(copy, price) } : null;
}

/** What "Resumo do pedido" draws for the chosen way to pay, or `undefined` when it is not priced. */
export function columnPrice(
  list: Pick<CheckoutPaymentList, "prices" | "door" | "copy">,
  choice: CheckoutListChoice | null,
): { discount?: { label: string; amountLabel: string }; title?: string; amountLabel: string } | undefined {
  const price = chosenPrice(list, choice);
  if (!price) return undefined;
  return { discount: price.discount, title: dueTitle(list.copy, choice), amountLabel: priceText(list.copy, price) };
}

/**
 * Which price an order raised for this choice is for (`CreateOrderRequest.pricedAs`)
 * — `undefined` for a list the host did not price, which raises as before.
 */
export function raisedAs(list: Pick<CheckoutPaymentList, "prices">, choice: { method: CheckoutOnlineChoice; funding?: "DEBIT" } | null): CheckoutPricedAs | undefined {
  if (!list.prices || !choice) return undefined;
  return onlineRowId(choice) ?? undefined;
}
