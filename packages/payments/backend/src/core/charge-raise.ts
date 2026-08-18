import { attributedCard, holdsInstrumentFor } from './card-instrument';
import { ChargeIdentityError, chargeIdentityMismatch } from './charge-identity';
import type { ChargeQueryStore } from './charge-queries';
import { hostedChargePayable, pixChargePayable } from './charge-reuse';
import { UnsupportedOperationError } from './errors';
import { attemptIdempotencyKey, attemptReference } from './reference';
import type { CardDetails, ChargeSnapshot, CustomerInfo, MerchantRef, Money } from './types';

/**
 * RAISE A CHARGE FOR ONE HOST REFERENCE — the composition every adopting host
 * wrote for itself (FUT-760).
 *
 * The pieces have all been here for a while: `attemptIdempotencyKey` and
 * `attemptReference` mint the per-attempt identity, `ChargeQueryStore` answers
 * what is already payable, `chargeIdentityMismatch` checks what came back, and
 * `cancelCharge` voids what a reprice left behind. What was NOT here is the
 * ORDER they go in — and that order is the whole safety argument. A host that
 * assembles it itself is re-deriving, from scratch, four rules whose failure
 * modes all end with a buyer charged twice or a payment nobody can settle:
 *
 *  1. **Reuse is checked BEFORE the ordinal is read.** Reusing must not advance
 *     the count: the reused charge is still that reference's current attempt,
 *     and bumping here would hand the NEXT real attempt a key one ahead of the
 *     row it stores.
 *  2. **Hosted is checked first, and for either method.** A redirect provider's
 *     page offers its own methods, so the method the buyer picked does not
 *     narrow what is payable. It is skipped when the caller brings an
 *     instrument for that provider — a card the buyer just typed must not be
 *     silently ignored in favour of an old link.
 *  3. **The returned row is not taken on trust.** A provider that dedupes on
 *     its own reference answers this attempt with the LAST one's charge; the
 *     mismatch THROWS rather than returning, because writing bookkeeping
 *     against a charge nobody raised now is how a buyer pays and nothing
 *     settles.
 *  4. **Superseded codes are voided only AFTER the new charge is proven good.**
 *     The buyer must never be left with the old code voided and no new one to
 *     pay.
 *
 * What stays the HOST's: which reference is being paid and what it is worth
 * (read server-side, never from the browser), who the buyer is, and the
 * merchant. This function is handed those and decides nothing about them.
 */

/** The gateway operations a raise needs — deliberately narrower than the whole. */
export interface ChargeRaiseGateway {
  charge(
    merchant: MerchantRef,
    input: {
      reference: string;
      amount: Money;
      method: 'PIX' | 'CARD';
      customer: CustomerInfo;
      card?: CardDetails;
      idempotencyKey?: string;
    },
  ): Promise<{ reference: string; idempotencyKey: string | null; snapshot: ChargeSnapshot }>;
  cancelCharge(
    merchant: MerchantRef,
    provider: string,
    providerChargeId: string,
  ): Promise<ChargeSnapshot>;
}

/**
 * Where a void that could not happen gets reported.
 *
 * REQUIRED, with no default. A best-effort void that fails silently is the one
 * outcome this module must never produce: the stale code stays scannable, the
 * buyer can still pay it, and nobody finds out. A host that wants no output
 * passes no-ops and has said so.
 */
export interface ChargeRaiseLog {
  warn(message: string): void;
  error(message: string): void;
}

export interface ChargeRaiseDeps {
  gateway: ChargeRaiseGateway;
  charges: ChargeQueryStore;
  log: ChargeRaiseLog;
}

export interface RaiseChargeRequest {
  merchant: MerchantRef;
  /** The host's own id for the thing being paid — an order, an invoice. */
  reference: string;
  /** Authoritative, read server-side. The browser never supplies this. */
  amount: Money;
  method: 'PIX' | 'CARD';
  customer: CustomerInfo;
  card?: CardDetails;
}

/** A still-payable charge left behind by a reprice. */
interface SupersededCharge {
  provider: string;
  providerChargeId: string;
  amountCents: number;
}

/** The payable charge to hand back instead of raising, or null. */
async function reusableCharge(
  deps: ChargeRaiseDeps,
  request: RaiseChargeRequest,
): Promise<ChargeSnapshot | null> {
  const { merchant, reference, amount } = request;
  const [hosted] = await deps.charges.listPayable({ merchant, reference, amount });
  if (hosted && hostedChargePayable(hosted.snapshot)) {
    // An instrument for THIS provider means the buyer chose a card now; the
    // link they had is not the same answer any more.
    if (!holdsInstrumentFor(request.card, hosted.snapshot.provider)) return hosted.snapshot;
  }
  // PIX ONLY. A card attempt carries an instrument, so reusing would ignore the
  // card the buyer just typed. PIX carries none — the QR IS the charge.
  if (request.method !== 'PIX' || request.card) return null;
  const [pix] = await deps.charges.listPayable({ merchant, reference, amount, method: 'PIX' });
  if (!pix) return null;
  return pixChargePayable(pix.snapshot) ? pix.snapshot : null;
}

/**
 * Void the codes a reprice left behind, best-effort and never fatal.
 *
 * BEST-EFFORT IS NOT SILENT. Two outcomes, both reported:
 *
 *  - the provider CANNOT void — `cancelCharge` is optional on the adapter, so
 *    the gateway refuses with `UnsupportedOperationError` rather than
 *    pretending. The stale code stays payable until it expires and the log says
 *    so by name. This is the accepted trade: refusing the reprice instead would
 *    block a discount on something the buyer can still pay correctly.
 *  - the void FAILED — network, credentials, a provider rejection. Logged as an
 *    error, because unlike the case above a retry might have worked and an
 *    operator can still void it by hand.
 *
 * Never throws. The new charge is already valid and the buyer is waiting on it;
 * failing their checkout because an OLD code could not be voided turns a
 * stale-code risk into a total outage of the payment path.
 */
async function voidSuperseded(
  deps: ChargeRaiseDeps,
  request: RaiseChargeRequest,
): Promise<void> {
  const { merchant, reference, amount } = request;
  let stale: SupersededCharge[];
  try {
    const rows = await deps.charges.listPayable({
      merchant,
      reference,
      method: 'PIX',
      // Excluding the CURRENT amount is also what keeps this from voiding the
      // code just raised, which is priced at exactly that.
      amountNot: amount,
    });
    stale = rows.map(({ snapshot }) => ({
      provider: snapshot.provider,
      providerChargeId: snapshot.providerChargeId,
      amountCents: snapshot.amount.amountCents,
    }));
  } catch (error) {
    deps.log.error(
      `payments.void could not list superseded charges for ${reference}: ${reason(error)}`,
    );
    return;
  }

  for (const charge of stale) {
    const what =
      `${charge.provider} charge ${charge.providerChargeId} ` +
      `(${charge.amountCents} cents) on ${reference}`;
    try {
      await deps.gateway.cancelCharge(merchant, charge.provider, charge.providerChargeId);
    } catch (error) {
      if (error instanceof UnsupportedOperationError) {
        deps.log.warn(`payments.void unsupported: ${what} stays payable until it expires`);
      } else {
        deps.log.error(`payments.void failed for ${what}: ${reason(error)}`);
      }
    }
  }
}

/**
 * A STRING, never the error object. Loggers commonly inspect extra arguments
 * recursively, and `ProviderRequestError` retains the provider's parsed body —
 * which is how a payload echoing the buyer's name, e-mail and tax id ends up in
 * operational logs.
 */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * Build the raise. A DECLINE is a normal return value (`status: 'DECLINED'`) —
 * the buyer needs a message, not a stack trace. Only a transport or account
 * failure throws, plus {@link ChargeIdentityError} for rule 3 above.
 */
export function createChargeRaiser(deps: ChargeRaiseDeps) {
  return async function raiseCharge(request: RaiseChargeRequest): Promise<ChargeSnapshot> {
    const live = await reusableCharge(deps, request);
    if (live) return live;

    const attempt = await deps.charges.countByReference(request.merchant, request.reference);
    const idempotencyKey = attemptIdempotencyKey(request.reference, attempt);
    const stored = await deps.gateway.charge(request.merchant, {
      // PER ATTEMPT, not per reference: a provider that dedupes on the
      // reference hands every later attempt the charge it minted for the
      // first, which then collides with that first attempt's stored row.
      reference: attemptReference(request.reference, attempt),
      amount: request.amount,
      method: request.method,
      customer: request.customer,
      card: attributedCard(request.card),
      idempotencyKey,
    });

    const mismatch = chargeIdentityMismatch(stored, {
      reference: request.reference,
      idempotencyKey,
    });
    // Fail CLOSED. Returning here is what burns another charge's id onto this
    // reference's bookkeeping; the charge that came back is left exactly as it
    // was, for an operator to reconcile, and the buyer simply retries.
    if (mismatch) throw new ChargeIdentityError(stored, mismatch);

    await voidSuperseded(deps, request);
    return stored.snapshot;
  };
}
