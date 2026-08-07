import { ChargeIdentityError, chargeIdentityMismatch } from '../core/charge-identity';
import type { PaymentsGateway } from '../core/gateway';
import type { ChargeQueryStore } from '../core/ports';
import { attemptReference } from '../core/reference';
import type { ChargeSnapshot, PaymentMethodKind } from '../core/types';

import {
  holdsInstrumentFor,
  reusableHostedCharge,
  reusablePixCharge,
  type CheckoutCard,
} from './reuse';
import { voidSupersededPixCharges } from './supersede';
import type { CheckoutLogger, Payable } from './types';

/**
 * THE CHARGE ENTRY POINT — the one function every checkout path goes through.
 *
 * Everything vendor-specific is already below it, in the gateway: which
 * providers the merchant connected, which API to call, how to shape the
 * request, how to read the response, and the failover proof rules that decide
 * when a walk may advance. What this adds is the part that must never be a
 * caller's choice.
 *
 * THE IDEMPOTENCY KEY IS PER ATTEMPT, NOT PER PAYABLE (FUT-377), and it is
 * resolved HERE rather than passed in. A caller that forgot to bump it pinned
 * every charge of a payable to one key, and the gateway answers a known key
 * with the charge it already stored — a correct dedup for a retry and a silent
 * wrong answer for anything else: a repriced payable got the OLD amount and the
 * OLD QR back, and a card attempt after a PIX one got the PIX charge back.
 * There is no parameter here for a caller to get wrong, so no route can opt out.
 *
 * AND THE KEY IS NOT TAKEN ON TRUST (FUT-378). The row that comes back is
 * checked against the row that was asked for — same payable, same attempt —
 * before its snapshot is handed to anybody, and a mismatch THROWS rather than
 * returning. The two identity facts live on the STORED ROW and nowhere else: a
 * `ChargeSnapshot` carries no idempotency key, so this is the only place the
 * question can be asked at all.
 */

interface RaiseChargeDeps {
  gateway: PaymentsGateway;
  charges: ChargeQueryStore;
  log: CheckoutLogger;
}

interface RaiseChargeRequest {
  method: PaymentMethodKind;
  card?: CheckoutCard;
}

/**
 * The card block to send the gateway (FUT-563).
 *
 * When the browser minted one instrument PER provider, that map is the ONLY
 * thing sent: the bare `token` is dropped on purpose. An unattributed token
 * defaults to the chain head, and every provider WITHOUT an entry in the map
 * would then be refused as "holding someone else's instrument" — including a
 * REDIRECT provider, which needs no instrument at all and would otherwise be
 * the one entry a card charge could always fall through to.
 *
 * A saved instrument is untouched: its owner is the provider whose vault holds
 * it, which the gateway resolves for itself.
 */
function chargeInstrument(card: CheckoutCard | undefined): CheckoutCard | undefined {
  const minted = card?.tokensByProvider;
  if (!card || !minted || Object.keys(minted).length === 0) return card;
  if (card.savedCardToken) return card;
  return { tokensByProvider: minted };
}

/**
 * A live charge this request must be answered with instead of raising a new one.
 *
 * Checked BEFORE the ordinal is read, because reusing must not advance it: the
 * reused charge is still the payable's current attempt, and bumping the count
 * here would hand the NEXT real attempt a key one ahead of the row it stores.
 */
async function liveChargeFor(
  deps: RaiseChargeDeps,
  payable: Payable,
  request: RaiseChargeRequest,
): Promise<ChargeSnapshot | null> {
  const hosted = await reusableHostedCharge(deps.charges, payable);
  if (hosted && !holdsInstrumentFor(request.card, hosted.provider)) return hosted;
  if (request.method === 'PIX' && !request.card) {
    return reusablePixCharge(deps.charges, payable);
  }
  return null;
}

/**
 * Raise a charge for a payable and return the normalized snapshot.
 *
 * A DECLINE is a normal return value here (`status: 'DECLINED'`), not a throw —
 * the buyer needs a message, not a stack trace. Only a transport, account or
 * identity failure throws.
 */
export async function raiseCharge(
  deps: RaiseChargeDeps,
  payable: Payable,
  request: RaiseChargeRequest,
): Promise<ChargeSnapshot> {
  const live = await liveChargeFor(deps, payable, request);
  if (live) return live;

  const attempt = await deps.charges.countByReference(payable.merchant, payable.ref);
  const idempotencyKey = `${payable.ref}:${attempt}`;
  const reference = attemptReference(payable.ref, attempt);
  const stored = await deps.gateway.charge(payable.merchant, {
    // PER ATTEMPT, not per payable: a provider that dedupes on the reference
    // hands every later attempt the charge it minted for the first one, and
    // that charge then collides with the first attempt's stored row (FUT-669).
    reference,
    amount: payable.amount,
    method: request.method,
    // Passed through as collected — absent stays absent. Which fields are
    // REQUIRED is the adapter's declaration (`customerSchema`, FUT-595),
    // enforced by the gateway before the charge is attempted; padding absences
    // with "" here would only disguise a missing field from it.
    customer: payable.customer,
    card: chargeInstrument(request.card),
    idempotencyKey,
  });

  const mismatch = chargeIdentityMismatch(stored, { reference: payable.ref, idempotencyKey });
  // Fail CLOSED. Returning here is what burns another charge's id onto this
  // payable's bookkeeping; the charge that came back is left exactly as it was,
  // for an operator to reconcile, and the buyer simply retries.
  if (mismatch) throw new ChargeIdentityError(stored, mismatch);

  // Only once THIS attempt's charge is proven good: the buyer must never be
  // left with the old code voided and no new one to pay.
  await voidSupersededPixCharges(deps, payable);
  return stored.snapshot;
}
