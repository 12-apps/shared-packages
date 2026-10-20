import { authenticatePagBankDebit, type ThreeDSFailure } from "../../card/three-ds";
import { err, ok, type Result } from "../../result";

import type { CheckoutBillingAddress, PaymentListDebitCopy } from "./list/types";
import type { CheckoutClient } from "./transport";
import type { BuyerInfo, CheckoutOrder } from "./types";

/**
 * A DEBIT card's 3-D Secure, between the card's encryption and its charge
 * (FUT-3754).
 *
 * The session is minted by the server for the order's own store (`/3ds-session`
 * is payable-scoped), the provider's SDK authenticates the encrypted card in
 * this browser — drawing the bank's challenge itself when the bank asks for
 * one — and the id it answers is what the debit charge carries. Nothing is
 * charged when the authentication fails: the buyer reads why and stays on the
 * list with the card they typed.
 */

/** What the debit row hands the card charge: the address the bank checks, and the row's words. */
export interface DebitAuthentication {
  billingAddress: CheckoutBillingAddress;
  copy: PaymentListDebitCopy;
}

/** The session a stub connection answers — authenticating it needs no SDK and no bank. */
const STUB_SESSION = "stub-3ds-session";

function failureWords(copy: PaymentListDebitCopy, failure: ThreeDSFailure): string {
  if (failure === "NOT_SUPPORTED") return copy.notSupported;
  if (failure === "REFUSED") return copy.refused;
  return copy.failed;
}

/** The authentication id to charge the debit card with, or the buyer's reason why not. */
export async function authenticateDebit(input: {
  client: Pick<CheckoutClient, "threeDSecureSession">;
  order: CheckoutOrder;
  buyer: BuyerInfo;
  encryptedCard: string;
  debit: DebitAuthentication;
}): Promise<Result<string>> {
  const { copy } = input.debit;
  const minted = await input.client.threeDSecureSession?.({ orderId: input.order.orderId });
  if (!minted?.ok) return err(copy.failed);
  if (minted.data.session === STUB_SESSION) return ok("stub-3ds");
  const outcome = await authenticatePagBankDebit({
    session: minted.data.session,
    environment: minted.data.environment,
    encryptedCard: input.encryptedCard,
    amountCents: input.order.amountDueCents ?? input.order.totalCents,
    customer: {
      name: input.buyer.name ?? "",
      email: input.buyer.email ?? "",
      phone: input.buyer.phone ?? "",
    },
    billingAddress: input.debit.billingAddress,
  });
  return outcome.ok ? ok(outcome.authenticationId) : err(failureWords(copy, outcome.failure));
}
