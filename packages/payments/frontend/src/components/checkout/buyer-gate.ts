/**
 * What the "Continuar" gate objects to (FUT-595), split out of
 * `use-checkout-controller.ts`.
 *
 * Its own module because the answer is a pure function of what the store's
 * chain declared, the buyer's form, and the words a host chose — nothing in
 * here touches React, a network or the controller's state machine, and the
 * controller was over the file-size gate carrying it.
 */
import { buyerFormComplete } from "./buyer-info-form";
import type { CheckoutValidationCopy } from "./screens-copy";
import type { BuyerField, BuyerInfo, CheckoutCustomerField } from "./types";

/**
 * The message shown when a declared field is missing or malformed — the HOST's
 * words (FUT-760), keyed by the field the chain declared.
 *
 * Built from the copy rather than held as a module constant: a frozen table
 * could only carry the origin host's Portuguese, and it would reach every
 * adopter's buyer on the very first field they got wrong.
 */
function fieldComplaints(copy: CheckoutValidationCopy): Record<string, string> {
  return {
    taxId: copy.taxIdInvalid,
    name: copy.nameRequired,
    email: copy.emailInvalid,
    phone: copy.phoneInvalid,
  };
}

/** Which input to highlight for a declared key. */
const FIELD_INPUT: Record<string, BuyerField> = {
  taxId: "cpf",
  name: "name",
  email: "email",
  phone: "phone",
};

/**
 * What the "Continuar" gate objects to, or undefined to advance.
 *
 * The fields come from the chain's own declaration (FUT-595) — absent, they
 * degrade to CPF-required, which is exactly what this gate has always demanded.
 *
 * A blank CPF is only an error when the store has NO CPF for this buyer. With
 * one on file the field starts empty by design (the client is never sent the
 * saved CPF), so demanding one here trapped a returning buyer who opened Dados
 * through "Alterar" and changed their mind: they could not reach Pagamento
 * again, and back only led out to the menu. Leaving it blank means "charge me
 * as before", which is exactly what the server's `resolveBuyerTaxId` does.
 */
export function buyerGateError(
  copy: CheckoutValidationCopy,
  buyer: BuyerInfo,
  fields: readonly CheckoutCustomerField[],
  taxIdOnFile: boolean,
): { message: string; field: BuyerField } | undefined {
  const effective = taxIdOnFile
    ? fields.filter((field) => !(field.key === "taxId" && !buyer.taxId?.trim()))
    : fields;
  const offending = buyerFormComplete(buyer, effective);
  if (!offending) return undefined;
  return {
    message: fieldComplaints(copy)[offending.key] ?? copy.required,
    field: FIELD_INPUT[offending.key] ?? "cpf",
  };
}

