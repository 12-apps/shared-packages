import type { CustomerInfo } from './customer-schema';
import type { PaymentsGateway } from './gateway';
import { isInstallmentCount, type InstallmentQuote } from './installments';
import { splitOf, type ReturnedCharge } from './cycle-split';
import type { CredentialStore } from './ports';
import type { ChargeSnapshot, MerchantRef, Money, ProviderName } from './types';

/**
 * Collecting one due billing cycle — the recurring money path (ported from the
 * first adopting host, FUT-760).
 *
 * A SUBSCRIPTION is not a checkout. The buyer is the merchant's own customer
 * rather than a shopper, nobody is at the keyboard, and the charge is raised
 * against the PLATFORM's merchant account rather than the tenant's connected
 * one — billing a store's own acquirer for its own subscription would take the
 * money and hand it straight back. That inversion is why this cannot reuse the
 * checkout flow, and why it is worth having once rather than per host.
 *
 * Two methods, one set of guards. The push method (PIX, boleto — anything the
 * customer is shown and pays themselves) needs no stored instrument; the pull
 * method charges a card on file off-session. Both settle through the same
 * webhook and the same `(provider, providerChargeId)` key, so nothing
 * downstream has to know which was used.
 *
 * ## The cycle's own id is the idempotency key
 *
 * A cycle exists as a row before anyone is asked to pay it, so its id is stable
 * across every retry — a re-run of the sweep, a queue redelivery, an operator
 * retrying by hand — and they all collapse onto ONE charge at the provider
 * rather than billing the customer twice. Nothing here mints a key.
 *
 * ## Skips are answers, not failures
 *
 * Every normal state of the world comes back as a `skipped` reason: no platform
 * account, an already-settled cycle, a cycle that already has a charge open, a
 * customer with no card. Only a genuine provider or transport failure throws,
 * so a caller sweeping hundreds of tenants can tell "nothing to do here" from
 * "this deployment is broken".
 *
 * ## Instalments are re-quoted, and pinned to the quoting provider
 *
 * `collectByCard(id, { installments: N })` with N above 1 asks the provider
 * for its price at the moment of the charge (`core/installments.ts`) and raises
 * the QUOTED total split in N, the buyer paying the acquirer's interest. A
 * total shown earlier is never reused. The charge is pinned to the provider
 * that quoted, so failover can never land the total on an acquirer that priced
 * nothing. A provider that does not quote is a skip, never a single payment.
 */

/** Why a cycle could not be charged, when the reason is not an exception. */
export type CollectionSkip =
  /** This deployment has no platform merchant account configured. */
  | 'no-platform-account'
  /** No such cycle, or it is not this caller's. */
  | 'unknown-payment'
  /** Already settled — a webhook or an earlier attempt got there first. */
  | 'already-paid'
  /** A charge is already open at the provider for this cycle. */
  | 'already-charged'
  /** The customer has never added a card. Nothing to charge; dunning chases. */
  | 'no-instrument'
  /**
   * The customer HAS a card, but at a provider the platform no longer collects
   * through. Distinct from `no-instrument` because it is the platform's doing,
   * not theirs — someone switched acquirer — and they need different words.
   */
  | 'instrument-elsewhere'
  /** Instalments asked of a provider that prices none — nothing was charged. */
  | 'installments-unsupported'
  /** The count is not 1..12, or past what the provider splits into. */
  | 'installments-out-of-range'
  /** The provider splits only with the cardholder present, and `cardholderPresent` was not set. */
  | 'installments-merchant-initiated';

export interface CollectionResult {
  skipped: CollectionSkip | null;
  snapshot: ChargeSnapshot | null;
  /**
   * Set only when the charge that came back is NOT the one this call asked for
   * — the gateway answers a known idempotency key (the cycle's id) with the
   * charge already stored under it, e.g. an earlier sweep's 3x whose
   * `recordRaised` failed. The charge id is still recorded (it exists); the
   * split is taken from the returned charge when it reports one, never from
   * this call's quote. A short operator-facing reason, never buyer copy.
   */
  chargeMismatch?: string;
}

const SKIPPED = (reason: CollectionSkip): CollectionResult => ({ skipped: reason, snapshot: null });

/** One due cycle, reduced to what collecting it needs to know. */
export interface CollectableCycle {
  /** Also the provider reference AND the idempotency key — see the module doc. */
  id: string;
  /** The subscription this cycle belongs to, for the instrument lookup. */
  groupId: string;
  amount: Money;
  /** The customer as the provider must see them. */
  customer: CustomerInfo;
}

/** A card on file, and who vaulted it. */
export interface BillingInstrument {
  provider: ProviderName;
  providerInstrumentId: string;
  /**
   * Nullable, not just optional: "this provider needs no customer ref" arrives
   * from a host's own column, and a nullable column is the ordinary shape for
   * it. Normalized before the charge — making every host map `null` to
   * `undefined` at the seam is friction a port should absorb.
   */
  providerCustomerId?: string | null | undefined;
}

/**
 * The host's cycle rows.
 *
 * `read` returns null for BOTH "no such row" and "not chargeable" — unknown,
 * settled, refunded. The distinction that matters to this flow is only whether
 * a charge is already outstanding, which `providerChargeId` carries; the rest
 * is the host's own status vocabulary and stays there.
 */
export interface CycleStore {
  read(cycleId: string): Promise<{ cycle: CollectableCycle; providerChargeId: string | null } | 'unknown' | 'settled'>;
  /** Stamp WHICH provider holds the charge. Without it the next sweep duplicates. */
  recordRaised(cycleId: string, charge: RaisedCharge): Promise<void>;
}

/** What `recordRaised` is told. `installments` is present only for a charge split in 2..12. */
export interface RaisedCharge {
  provider: ProviderName;
  providerChargeId: string;
  method: 'PIX' | 'CARD';
  /**
   * The cycle's own price (`principal`) kept apart from what was taken
   * (`total`, principal plus the buyer's interest), so the cycle never reads
   * as having cost more than it did.
   *
   * This and the returned snapshot's `installments`/`principal` are the ONLY
   * places the split is told: the gateway's charge store keeps the snapshot
   * the adapter answered, which reports the total. Persist it from here.
   */
  installments?: {
    /** Absent when no adapter report or fresh raise confirms it — see `chargeMismatch`. */
    count?: number;
    principal: Money;
    total: Money;
  };
}

/** How `collectByCard` charges. Omitted: one payment, exactly as before. */
export interface CardCollectionOptions {
  /** 1..12; default 1. Above 1 needs a provider that quotes — see the module doc. */
  installments?: number;
  /**
   * The cardholder is at the screen paying this cycle themselves. Default
   * false: a cycle is collected merchant-initiated. When true the charge (and
   * its quote) go out customer-initiated, which a provider whose instalments
   * refuse merchant-initiated charges accepts — but a customer-initiated charge
   * on a stored card may need 3-D Secure or the CVV, and can come back
   * PENDING rather than PAID; settlement then arrives by webhook as usual.
   */
  cardholderPresent?: boolean;
}

/**
 * The card on file AT a given provider.
 *
 * `hasAny` is what separates `no-instrument` from `instrument-elsewhere`: a
 * customer holding a card the platform can no longer charge is not a customer
 * who never added one, and telling them the same thing is how a solvable
 * problem reads as a dead end.
 */
export type InstrumentLookup = (
  groupId: string,
  provider: ProviderName,
) => Promise<{ instrument: BillingInstrument | null; hasAny: boolean }>;

export interface CycleCollectionDeps {
  /** `quoteInstallments` is needed only to collect in instalments; without it they are skipped. */
  gateway: Pick<PaymentsGateway, 'charge'> & Partial<Pick<PaymentsGateway, 'quoteInstallments'>>;
  credentials: Pick<CredentialStore, 'defaultProvider'>;
  cycles: CycleStore;
  instruments: InstrumentLookup;
  /** The PLATFORM's merchant — never the tenant's own connected account. */
  merchant: MerchantRef;
  /**
   * Whether this deployment can collect at all. Checked FIRST and EARLY: an
   * environment with no platform account should do nothing quietly rather than
   * throw once per tenant deep inside the gateway.
   */
  enabled(): Promise<boolean>;
}

export interface CycleCollector {
  /**
   * Raise the charge the customer pays THEMSELVES — a QR, a slip, a link.
   *
   * ⚠️ Does NOT mark the cycle paid. These methods are asynchronous: nothing
   * has been paid at the moment the charge is created, and settlement is the
   * webhook's, which must stay the only place a cycle becomes paid.
   */
  collectByPush(cycleId: string): Promise<CollectionResult>;
  /**
   * Charge the card on file — the recurring path.
   *
   * A DECLINE comes back as a RESULT, in `snapshot.status`, not as a throw:
   * the caller's retry policy reads the reason off it.
   */
  collectByCard(cycleId: string, options?: CardCollectionOptions): Promise<CollectionResult>;
}

/** Load the cycle and rule out every reason it must NOT be charged. */
async function chargeable(
  deps: CycleCollectionDeps,
  cycleId: string,
): Promise<CollectableCycle | CollectionResult> {
  const row = await deps.cycles.read(cycleId);
  if (row === 'unknown') return SKIPPED('unknown-payment');
  // A refunded cycle counts as settled too: re-charging one would take the
  // money back off a customer who was just given it.
  if (row === 'settled') return SKIPPED('already-paid');
  // The row already carries a provider charge. For a push method that means a
  // payable code is outstanding and a second would let the customer pay twice;
  // for a card it means an attempt already reached the provider, and re-raising
  // it under a fresh key is exactly the double charge the idempotency key
  // exists to stop.
  if (row.providerChargeId) return SKIPPED('already-charged');
  return row.cycle;
}

/**
 * The three fields the store is told about — named rather than spread from the
 * gateway's row, so a `StoredCharge` gaining a field never silently starts
 * arriving at a host's `recordRaised`.
 */
function raisedOf(
  stored: { provider: ProviderName; providerChargeId: string },
  method: 'PIX' | 'CARD',
): RaisedCharge {
  return { provider: stored.provider, providerChargeId: stored.providerChargeId, method };
}

function isSkip(value: CollectableCycle | CollectionResult): value is CollectionResult {
  return 'skipped' in value;
}

export function createCycleCollector(deps: CycleCollectionDeps): CycleCollector {
  async function open(cycleId: string): Promise<CollectableCycle | CollectionResult> {
    if (!(await deps.enabled())) return SKIPPED('no-platform-account');
    return chargeable(deps, cycleId);
  }

  return {
    async collectByPush(cycleId) {
      const cycle = await open(cycleId);
      if (isSkip(cycle)) return cycle;

      const stored = await deps.gateway.charge(deps.merchant, {
        reference: cycle.id,
        amount: cycle.amount,
        method: 'PIX',
        customer: cycle.customer,
        idempotencyKey: cycle.id,
      });

      await deps.cycles.recordRaised(cycle.id, raisedOf(stored, 'PIX'));
      return { skipped: null, snapshot: stored.snapshot };
    },

    collectByCard: (cycleId, options = {}) => collectCard(deps, open, cycleId, options),
  };
}

type Opener = (cycleId: string) => Promise<CollectableCycle | CollectionResult>;

/**
 * The provider's price for `count`, asked NOW; null for one payment, which is
 * never quoted. A refusal comes back as the matching skip.
 */
async function quoteAt(
  deps: CycleCollectionDeps,
  provider: ProviderName,
  cycle: CollectableCycle,
  instrument: BillingInstrument,
  count: number,
  merchantInitiated: boolean,
): Promise<InstallmentQuote | CollectionResult | null> {
  if (count === 1) return null;
  if (!deps.gateway.quoteInstallments) return SKIPPED('installments-unsupported');
  const result = await deps.gateway.quoteInstallments(
    deps.merchant,
    {
      amount: cycle.amount,
      installments: count,
      card: { savedCardToken: instrument.providerInstrumentId },
      merchantInitiated,
    },
    provider,
  );
  return result.ok ? result.quote : SKIPPED(result.refusal);
}

/** One payment is today's call, argument for argument; a split one charges the quoted total, pinned. */
function raiseCard(
  deps: CycleCollectionDeps,
  cycle: CollectableCycle,
  instrument: BillingInstrument,
  quote: InstallmentQuote | null,
  { provider, merchantInitiated }: { provider: ProviderName; merchantInitiated: boolean },
) {
  const card = {
    savedCardToken: instrument.providerInstrumentId,
    customerRef: instrument.providerCustomerId ?? undefined,
    // Names the instrument's OWNER, so the gateway can never offer a
    // Stripe `pm_…` to PagBank and burn the chain on garbage input.
    tokenProvider: instrument.provider,
    // Nobody is at the keyboard (unless `cardholderPresent`), so the issuer
    // has to be told this is a subsequent charge under a stored-credential
    // agreement — otherwise it may decline for the absence of one, or hold the
    // intent waiting for an authentication a scheduled job can never give.
    merchantInitiated,
  };
  const input = { reference: cycle.id, method: 'CARD' as const, customer: cycle.customer, idempotencyKey: cycle.id };
  if (!quote) return deps.gateway.charge(deps.merchant, { ...input, amount: cycle.amount, card });
  const split = { ...card, installments: quote.installments };
  return deps.gateway.charge(deps.merchant, { ...input, amount: quote.total, card: split }, { provider });
}

async function collectCard(
  deps: CycleCollectionDeps,
  open: Opener,
  cycleId: string,
  options: CardCollectionOptions,
): Promise<CollectionResult> {
  const count = options.installments ?? 1;
  const merchantInitiated = !options.cardholderPresent;
  const cycle = await open(cycleId);
  if (isSkip(cycle)) return cycle;
  if (!isInstallmentCount(count)) return SKIPPED('installments-out-of-range');

  // WHO collects today — the head of the platform's chain, which an
  // operator switch writes. Null means nothing is enabled at all, which
  // `enabled()` above has already largely ruled out.
  const provider = await deps.credentials.defaultProvider(deps.merchant);
  if (!provider) return SKIPPED('no-platform-account');

  const { instrument, hasAny } = await deps.instruments(cycle.groupId, provider);
  if (!instrument) return SKIPPED(hasAny ? 'instrument-elsewhere' : 'no-instrument');

  const quote = await quoteAt(deps, provider, cycle, instrument, count, merchantInitiated);
  if (quote && 'skipped' in quote) return quote;

  const since = new Date();
  const stored = await raiseCard(deps, cycle, instrument, quote, { provider, merchantInitiated });
  return recordCard(deps, cycle, { ...stored, since }, quote);
}

/**
 * Record the provider charge ONLY when one is actually outstanding. A declined
 * card left nothing behind — no authorization, nothing payable — and stamping
 * it would make the `already-charged` guard fire on every subsequent attempt,
 * silently converting the retry ladder into a single try. A PENDING or PAID
 * charge is the opposite: it exists, and the guard is what stops a second one.
 */
async function recordCard(
  deps: CycleCollectionDeps,
  cycle: CollectableCycle,
  stored: ReturnedCharge,
  quote: InstallmentQuote | null,
): Promise<CollectionResult> {
  const { split, mismatch, method } = splitOf(stored, cycle, quote);
  if (stored.snapshot.status !== 'DECLINED') {
    await deps.cycles.recordRaised(cycle.id, split ? { ...raisedOf(stored, method), installments: split } : raisedOf(stored, method));
  }
  const count = split?.count === undefined ? {} : { installments: split.count };
  const snapshot = split ? { ...stored.snapshot, ...count, principal: split.principal } : stored.snapshot;
  return mismatch ? { skipped: null, snapshot, chargeMismatch: mismatch } : { skipped: null, snapshot };
}
