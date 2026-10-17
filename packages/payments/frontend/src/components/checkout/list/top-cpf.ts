/**
 * The CPF asked ONCE, at the top of the Pagamento step (FUT-3685, contract E1,
 * E2, E3, R2, R3).
 *
 * PagBank charges a wallet as a card and requires the buyer's tax id on every
 * order, and neither wallet's sheet can supply one. So the CPF cannot wait
 * inside the chosen row any more: a wallet button is pressed with no row
 * chosen at all. It is asked above the wallets, when ANY way to pay the list
 * offers online needs it under the chain rule (FUT-526) — the union over the
 * offered methods, never the chosen row (R2) — and it gates the online ways to
 * pay only: a door row never needs it (R3).
 *
 * Every other field a method asks for (the hand-off provider's mobile, K4)
 * stays inside its own row.
 */
import { buyerFieldsFor, fieldSatisfied } from "../buyer-fields";
import type { BuyerInfo, CheckoutChainLink, CheckoutCustomerField, PaymentMethod } from "../types";

/** Whether a field asks for the buyer's CPF. */
export function isTaxId(field: Pick<CheckoutCustomerField, "key">): boolean {
  return field.key === "taxId";
}

/** The required CPF the chain asks for under any of `methods`, or `null` when none does. */
function requiredTaxId(
  chain: readonly CheckoutChainLink[] | undefined,
  methods: readonly PaymentMethod[],
): CheckoutCustomerField | null {
  for (const method of methods) {
    const field = buyerFieldsFor(chain, method).find((candidate) => isTaxId(candidate) && candidate.required);
    if (field) return field;
  }
  return null;
}

/**
 * The CPF field the top of Pagamento shows, or `null` for none (E1, E2).
 *
 *  - Decided against what the buyer ARRIVED with, never what they are typing,
 *    so the field does not vanish under their thumb as it completes.
 *  - A buyer with a CPF on file sees no field — until they press "Alterar" on
 *    the payer line (`revealed`, E2 → E1). That field opens holding the CPF
 *    the host passed (masked, editable) and is OPTIONAL: empty means "keep the
 *    CPF the store holds" — a host that does not pass it (the field opens
 *    empty) must not strand the buyer — and only a non-empty CPF that is not
 *    valid holds the online ways to pay, with the reason (E3, K6). "Manter o
 *    CPF salvo" closes it again.
 */
export function topCpfField(input: {
  chain: readonly CheckoutChainLink[] | undefined;
  /** Every online method the list offers, wallets included (they raise a CARD order). */
  methods: readonly PaymentMethod[];
  arrivedWith: BuyerInfo | undefined;
  taxIdOnFile: boolean;
  revealed: boolean;
}): CheckoutCustomerField | null {
  const field = requiredTaxId(input.chain, input.methods);
  if (!field) return null;
  if (input.taxIdOnFile) return input.revealed ? { ...field, required: false } : null;
  if (fieldSatisfied(field, input.arrivedWith?.taxId)) return null;
  return field;
}

/**
 * Whether the top CPF holds a payment raised with `method`: the method's own
 * chain needs it and it is not satisfied — or the buyer typed one that is not
 * valid, which would go out with any online payment.
 */
export function cpfHolds(
  top: CheckoutCustomerField | null,
  buyer: BuyerInfo,
  chain: readonly CheckoutChainLink[] | undefined,
  method: PaymentMethod,
): boolean {
  if (!top || fieldSatisfied(top, buyer.taxId)) return false;
  const typed = (buyer.taxId ?? "").trim() !== "";
  return typed || requiredTaxId(chain, [method]) !== null;
}

/**
 * The provider the hint names — "o PagBank pede para pagar pelo app" (T3): the
 * first chain member that asks for the CPF under one of `methods` (or declares
 * nothing, which reads as asking for it), else the chain head. `null` when the
 * member published no name.
 */
export function cpfProvider(
  chain: readonly CheckoutChainLink[] | undefined,
  methods: readonly PaymentMethod[],
): string | null {
  const asks = (link: CheckoutChainLink): boolean =>
    link.customerSchema === undefined || requiredTaxId([link], methods) !== null;
  const link = chain?.find(asks) ?? chain?.[0];
  return link?.displayName?.trim() || null;
}
