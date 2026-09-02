import type { ChargeInput, PaymentMethodKind } from '../core/types';
import type { StoneCopy } from './copy';
import { chargeDescription } from './shared';
import { customerType, documentDigits } from './stone-http';

/**
 * The Pagar.me v5 order REQUEST this adapter builds — split from
 * `stone-orders.ts` when that file crossed the size gate, along the seam it
 * already described: that file READS provider state, this one BUILDS what we
 * send. Nothing here consults a response, and nothing there constructs one.
 */

function customerPayload(input: ChargeInput): Record<string, unknown> {
  return {
    name: input.customer.name || undefined,
    email: input.customer.email || undefined,
    document: documentDigits(input.customer.taxId),
    type: customerType(input.customer.taxId),
  };
}

/** One summary line whose amount equals the total; detail stays in our DB. */
function itemsPayload(input: ChargeInput): Array<Record<string, unknown>> {
  return [
    {
      amount: input.amount.amountCents,
      description: chargeDescription(input, 255),
      quantity: 1,
      code: input.reference,
    },
  ];
}

function pixPayment(input: ChargeInput): Record<string, unknown> {
  return {
    payment_method: 'pix',
    pix: { expires_in: input.pix?.expiresInSeconds ?? 900 },
  };
}

function boletoPayment(input: ChargeInput, copy: StoneCopy): Record<string, unknown> {
  return {
    payment_method: 'boleto',
    boleto: { instructions: copy.payer.boletoInstructions, due_at: input.boleto?.dueDate },
  };
}

function cardPayment(input: ChargeInput, copy: StoneCopy): Record<string, unknown> {
  return {
    payment_method: 'credit_card',
    credit_card: {
      installments: input.card?.installments ?? 1,
      statement_descriptor: copy.payer.statementDescriptor,
      // A saved card charges by its vault id; a fresh one by the token the
      // browser minted with the PUBLIC key. No PAN ever reaches this process.
      ...(input.card?.savedCardToken
        ? { card_id: input.card.savedCardToken }
        : { card_token: input.card?.token ?? '' }),
    },
  };
}

/**
 * Kept as a TABLE rather than a switch so a new `PaymentMethodKind` fails
 * typecheck here instead of falling through to a card payload.
 *
 * PIX's entry ignores the copy — the code Stone mints carries no words of
 * ours — and says so by taking only what it uses; the call below supplies both
 * arguments and TypeScript accepts the narrower signature.
 */
const BY_METHOD: Record<
  PaymentMethodKind,
  (input: ChargeInput, copy: StoneCopy) => Record<string, unknown>
> = {
  PIX: pixPayment,
  BOLETO: boletoPayment,
  CARD: cardPayment,
};

function paymentPayload(input: ChargeInput, copy: StoneCopy): Record<string, unknown> {
  return BY_METHOD[input.method](input, copy);
}

/** The full `POST /orders` body for one charge. */
export function orderPayload(input: ChargeInput, copy: StoneCopy): Record<string, unknown> {
  return {
    code: input.reference,
    customer: customerPayload(input),
    items: itemsPayload(input),
    payments: [paymentPayload(input, copy)],
    metadata: { ...input.metadata, reference: input.reference },
    closed: true,
  };
}
