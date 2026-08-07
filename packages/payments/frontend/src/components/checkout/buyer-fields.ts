/**
 * WHAT THE BUYER MUST BE ASKED, derived from the chain's own declaration
 * (FUT-595, wired into the browser by FUT-741).
 *
 * The backend has published `customerSchema` per chain entry since FUT-740 and
 * validates every charge against it. The browser ignored it and asked for a CPF
 * and nothing else — right for one provider, wrong for a store whose provider
 * wants a mobile, and wrong in the expensive direction: the buyer finishes the
 * form, presses Pagar, and gets a 400 naming a field there was never an input
 * for. That is the third FUT-740 critical, one layer up.
 *
 * ## The degrade direction is the whole safety property
 *
 * A chain that declares nothing is NOT a chain that asks for nothing. An older
 * host, a hand-written config, a config that failed to load — all of them
 * arrive here as "no declaration", and the honest reading of that is "I do not
 * know", not "nothing is needed". So the fallback is today's behaviour: CPF,
 * required. Over-asking costs the buyer one field they may not have needed;
 * under-asking costs them a completed form and a refused charge.
 *
 * ## The union, not the head
 *
 * Every entry the walk may reach gets a vote, because the form is filled ONCE,
 * before the first attempt. `required` takes the strictest answer and the TYPE
 * takes the narrower rule (`MOBILE` ⊂ `PHONE`) for the same reason: a value
 * that satisfies only the laxer member strands the buyer on the stricter one.
 * This mirrors the server's `unionCustomerFields` exactly — deliberately, since
 * the two must not disagree about what a chain needs.
 */

import { validateCpf } from "../../card";

import type { CheckoutChainLink, CheckoutCustomerField, PaymentMethod } from "./types";

/** What a chain that declared nothing is assumed to need — today's behaviour. */
const CPF_REQUIRED: CheckoutCustomerField = { key: "taxId", type: "CPF", required: true };

/** The fields one entry asks for when charging via `method`. */
function fieldsOf(
  link: CheckoutChainLink,
  method: PaymentMethod | null,
): readonly CheckoutCustomerField[] {
  const declared = link.customerSchema ?? [];
  // No method chosen yet (the Dados step opens before the picker): collect the
  // union across every method, which is the up-front collection FUT-595 asks
  // for — a form that has to be re-opened after the method is picked is the
  // double typing this exists to remove.
  if (method === null) return declared;
  return declared.filter((field) => !field.methods || field.methods.includes(method));
}

/** Which type accepts a SUBSET of the other's values. `MOBILE` ⊂ `PHONE`. */
function narrowerType(
  a: CheckoutCustomerField["type"],
  b: CheckoutCustomerField["type"],
): CheckoutCustomerField["type"] {
  if (a === "PHONE" && b === "MOBILE") return "MOBILE";
  return a;
}

/** Merge one declaration into the running union. */
function absorb(
  byKey: Map<CheckoutCustomerField["key"], CheckoutCustomerField>,
  field: CheckoutCustomerField,
): void {
  const existing = byKey.get(field.key);
  if (!existing) {
    byKey.set(field.key, { key: field.key, type: field.type, required: field.required });
    return;
  }
  byKey.set(field.key, {
    ...existing,
    type: narrowerType(existing.type, field.type),
    required: existing.required || field.required,
  });
}

/**
 * The buyer fields to collect for this chain and method.
 *
 * An entry with NO declaration makes the answer uncertain, so the CPF is folded
 * in as required — see the module doc. That is deliberately not the same as
 * "the chain is empty": an empty chain means the store cannot charge at all,
 * and the caller renders the unavailable screen rather than a form.
 */
export function buyerFieldsFor(
  chain: readonly CheckoutChainLink[] | undefined,
  method: PaymentMethod | null,
): CheckoutCustomerField[] {
  if (!chain || chain.length === 0) return [CPF_REQUIRED];
  const byKey = new Map<CheckoutCustomerField["key"], CheckoutCustomerField>();
  // An UNDECLARED entry is not a silent one. It is an entry whose requirements
  // this browser cannot see, and the safe reading of that is the pre-FUT-595
  // rule it would have been charged under.
  if (chain.some((link) => link.customerSchema === undefined)) absorb(byKey, CPF_REQUIRED);
  for (const field of chain.flatMap((link) => fieldsOf(link, method))) absorb(byKey, field);
  return [...byKey.values()];
}

/** Whether a value satisfies one field's declared rule. */
const RULES: Record<CheckoutCustomerField["type"], (value: string) => boolean> = {
  NAME: (value) => value.trim().length >= 2,
  EMAIL: (value) => /^[^\s@]+@[^\s@]+$/.test(value) && /\.[^\s@.]+$/.test(value),
  // DDD + an 8-digit landline or a 9-digit mobile, mirroring the server's rule.
  PHONE: (value) => /^\d{10,11}$/.test(value.replace(/\D/g, "")),
  MOBILE: (value) => /^\d{2}9\d{8}$/.test(value.replace(/\D/g, "")),
  // The real check-digit rule, not a length test: the same validator the CPF
  // input has always used, so the form and the gate cannot disagree.
  CPF: (value) => validateCpf(value) === undefined,
};

/** Whether a declared field is satisfied by what the buyer typed. */
export function fieldSatisfied(field: CheckoutCustomerField, value: string | undefined): boolean {
  const typed = (value ?? "").trim();
  if (!typed) return !field.required;
  return RULES[field.type](typed);
}
