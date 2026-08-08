import type { ChargeQueryStore } from '../core/ports';
import type { CardDetails, ChargeSnapshot, Money, ProviderName } from '../core/types';

import type { Payable } from './types';

/**
 * WHEN A RE-TAP MUST NOT MINT A SECOND PAYABLE CHARGE (FUT-379 / FUT-604).
 *
 * The per-attempt idempotency key raises a FRESH charge whenever the previous
 * attempt persisted one — which a reprice needs (coupon applied, cart edited)
 * and a double-tap does not. Without the rules here, a buyer who simply tapped
 * "Pay" twice ended up holding two payable codes for one payable. Settlement is
 * idempotent, so it still settles once; the exposure is a buyer who pays BOTH.
 *
 * Cancelling the loser is not generally available: `cancelCharge` is optional on
 * the adapter contract and several vendors implement nothing. So the fix that
 * works on EVERY provider is to not mint the second code at all, and hand back
 * the live one instead.
 *
 * Every clause below narrows toward RAISING (the old behaviour). Reuse has to be
 * proved, never assumed.
 */

/** `true` only when the deadline is present AND already past. */
function isExpired(expiresAt: string | undefined): boolean {
  if (!expiresAt) return false;
  const deadline = Date.parse(expiresAt);
  // An unparseable deadline says nothing; treat it as absent rather than
  // stranding a buyer whose code is fine.
  if (Number.isNaN(deadline)) return false;
  return deadline <= Date.now();
}

/** The still-payable charges of this payable at THIS price, newest first. */
async function payableCharges(
  charges: ChargeQueryStore,
  payable: Pick<Payable, 'ref' | 'merchant' | 'amount'>,
  method?: 'PIX',
): Promise<ChargeSnapshot[]> {
  const rows = await charges.listPayable({
    merchant: payable.merchant,
    reference: payable.ref,
    amount: payable.amount,
    ...(method ? { method } : {}),
  });
  return rows.map((row) => row.snapshot);
}

/**
 * The still-payable HOSTED-CHECKOUT charge for this payable, or null (FUT-604).
 *
 * This is the ACROSS-REQUESTS half of "a REDIRECT provider commits the walk the
 * moment it mints a link". The in-walk half lives in `core/charge-attempt.ts`;
 * without this half, a second POST while a link is still payable walks the chain
 * again — the payable is still OPEN (a hosted handover leaves it there), the
 * attempt count has moved on, and the walk restarts at the head with no memory
 * of the link. Two payable charges for one payable, which is the exact double
 * charge the walk's own proof rules exist to prevent.
 *
 * Asked FIRST and for EITHER method, because a redirect provider's page offers
 * its own choice — the method picked here narrows nothing about what is payable.
 *
 * NO EXPIRY CLAUSE, deliberately: a hosted provider keeps its page alive on its
 * own schedule and tells us nothing about it, so there is no honest local test.
 * A link the provider has since closed fails at the provider, which is the same
 * place it would have failed anyway.
 */
export async function reusableHostedCharge(
  charges: ChargeQueryStore,
  payable: Pick<Payable, 'ref' | 'merchant' | 'amount'>,
): Promise<ChargeSnapshot | null> {
  const snapshots = await payableCharges(charges, payable);
  return snapshots.find((snapshot) => snapshot.hostedCheckoutUrl !== undefined) ?? null;
}

/**
 * The payable's still-payable PIX charge at THIS price, or null (FUT-379).
 *
 * PIX ONLY, and deliberately so. A card attempt carries an INSTRUMENT: reusing
 * an earlier charge would silently ignore the card the buyer just typed. PIX
 * carries no instrument — the QR IS the charge — so returning the existing one
 * is the same answer, not a stale one.
 *
 * The store's `listPayable` has already narrowed to PENDING at this exact price.
 * Two clauses remain that only the snapshot can answer: the row and its snapshot
 * are written together but only the snapshot carries the QR, so a row whose
 * snapshot holds none is not something a buyer can pay whatever its status
 * column says; and an elapsed `expiresAt` means they no longer can.
 */
export async function reusablePixCharge(
  charges: ChargeQueryStore,
  payable: Pick<Payable, 'ref' | 'merchant' | 'amount'>,
): Promise<ChargeSnapshot | null> {
  const snapshots = await payableCharges(charges, payable, 'PIX');
  return (
    snapshots.find(
      (snapshot) => snapshot.pix?.qrText && !isExpired(snapshot.pix.expiresAt),
    ) ?? null
  );
}

/**
 * Whether the request holds a card instrument THAT PROVIDER could charge.
 *
 * This is what decides whether a live hosted link is the honest answer to a
 * re-tap. The FUT-604 reuse guard used to read "the request carries no card",
 * which a card charge can never satisfy — it always sends one — so once a chain
 * could land on a REDIRECT provider from the card form, a second POST walked the
 * chain again while the first link was still payable.
 *
 * The question is not "is there a card in the request" but "could the card in
 * the request have produced a DIFFERENT charge at the provider holding the live
 * link". For a provider we minted no instrument for — a hosted page, which takes
 * the card on its own site — the answer is no, so the buyer gets the link they
 * already hold. For one we DID mint for (a redirect-based 3-D Secure raised from
 * the buyer's own instrument) the answer is yes, and reusing there would
 * silently ignore the card the buyer just entered.
 *
 * `tokensByProvider[provider]` reads a provider name only as a MAP KEY THE
 * BROWSER SUPPLIED — never as a comparison against a literal. No provider name
 * appears in this package's checkout code, and this is the closest it comes.
 */
export function holdsInstrumentFor(
  card: CheckoutCard | undefined,
  provider: ProviderName,
): boolean {
  if (!card) return false;
  const minted = card.tokensByProvider;
  if (minted && Object.keys(minted).length > 0) return Boolean(minted[provider]);
  // A wallet key counts (FUT-471): the buyer just authorized THIS payment on
  // the wallet sheet, and answering with a parked hosted link would silently
  // discard that authorization the same way ignoring a typed card would.
  return Boolean(card.token ?? card.savedCardToken ?? card.wallet);
}

/** The instrument fields a checkout request may carry. */
export type CheckoutCard = Pick<
  CardDetails,
  'token' | 'savedCardToken' | 'tokensByProvider' | 'wallet'
>;

/** A still-payable charge left behind by a reprice. */
interface SupersededCharge {
  provider: ProviderName;
  providerChargeId: string;
  /** The OLD price — what the buyer would pay if they used this code. */
  amount: Money;
}

/**
 * The payable's live PIX charges at a price that is NO LONGER the one owed.
 *
 * The mirror image of {@link reusablePixCharge}: same "still payable" clauses,
 * opposite amount test. A reprice MUST raise a new charge, which is what leaves
 * the previous one behind — still PENDING, still scannable, and priced at what
 * the payable used to cost.
 *
 * Why the stale code is not harmless: a settlement claim typically refuses only
 * an UNDER-payment. So a coupon that moves a payable from 10 to 8 leaves a
 * 10-priced code that still settles — the buyer overpays and the merchant owes a
 * refund. Voiding it at the provider is what stops the money moving at all.
 *
 * An already-lapsed code cannot be paid, so voiding it buys nothing and only
 * spends a provider call that is likely to be refused anyway.
 */
export async function supersededPixCharges(
  charges: ChargeQueryStore,
  payable: Pick<Payable, 'ref' | 'merchant' | 'amount'>,
): Promise<SupersededCharge[]> {
  const rows = await charges.listPayable({
    merchant: payable.merchant,
    reference: payable.ref,
    method: 'PIX',
    // Excluding the CURRENT amount is also what keeps this from voiding the
    // code this very attempt just minted.
    amountNot: payable.amount,
  });
  return rows
    .filter((row) => !isExpired(row.snapshot.pix?.expiresAt))
    .map((row) => ({
      provider: row.provider,
      providerChargeId: row.providerChargeId,
      amount: row.snapshot.amount,
    }));
}
