import {
  createCycleCollector,
  type CardCollectionOptions,
  type CollectionResult,
} from "@12-apps/payments-backend";

import { checkBreakdown } from "../breakdown";
import { BillingBreakdownError } from "../errors";
import type { CycleCharge } from "../usage-types";

import type { BillingPlatformDeps, CycleStore, CycleStoreFactory, InstrumentLookup } from "./ports";

/**
 * Subscription COLLECTION (FUT-132) — the platform-scoped binding of the
 * packaged cycle collector (FUT-760).
 *
 * ## What is here, and what is not
 *
 * The FLOW is `@12-apps/payments-backend`'s `createCycleCollector`: the guard
 * order, the idempotency rule, which refusal a customer is told about, and the
 * one that reads as an optimisation and is not — a DECLINED card records
 * nothing, because stamping it would make the already-charged guard fire on
 * every later attempt and silently turn a dunning retry ladder into a single
 * try. Every one of those has a failure mode that bills someone twice or stops
 * billing them at all.
 *
 * What is here is the binding that flow needs and cannot invent: which
 * merchant collects, whether this deployment can collect at all, and the two
 * host stores. What stays in the HOST is the part neither package may own —
 * its own cycle table, its status vocabulary, and how one of its rows becomes
 * a customer the provider will accept. Those arrive through `cycles`.
 *
 * ## Two methods, and which one a schedule uses
 *
 * `collectByCard` is the RECURRING path (FUT-340): the card on file, charged
 * off-session against whichever acquirer the platform is currently collecting
 * through. Its options — how many instalments, whether the cardholder is
 * present — are the collector's own and are handed to it unchanged
 * (FUT-4683), so a host never has to rebuild the collection to reach them.
 *
 * `collectByPush` is the pull-free path — a code or a link the customer pays
 * themselves, needing no stored instrument at all. Recurrency is normally
 * card-only, since a push charge per cycle is a request-and-wait and therefore
 * a dunning problem rather than a billing one, but it is what an annual plan or
 * an operator-driven "send them a payable code" would use.
 *
 * Both settle through the SAME webhook and the same provider charge key, so
 * nothing downstream has to know which was used.
 *
 * ⚠️ Neither marks the cycle paid. A push charge is asynchronous and a card
 * charge can be PENDING, so settlement stays the webhook's — the only place a
 * cycle should ever become paid.
 *
 * ## The breakdown guard (FUT-5094)
 *
 * With `breakdowns`, a cycle that carries a breakdown is charged only when
 * the breakdown passes `checkBreakdown` AND states the very amount and
 * currency the row will charge. Otherwise `BillingBreakdownError` is THROWN
 * and nothing reaches the provider: a row whose lines and amount disagree is
 * a deployment bug, and a skip would hide it. The check runs only for a row that would actually be
 * charged (no provider charge yet): a row the collector skips as already
 * charged keeps being skipped, never thrown on. A null breakdown (every cycle
 * before FUT-5094) charges exactly as before. The amount charged is always
 * the row's, unchanged.
 *
 * Server-only.
 */

/**
 * The breakdown the host persisted for one cycle, or null for a cycle that
 * has none.
 */
export type CycleBreakdownLookup = (cycleId: string) => Promise<CycleCharge | null>;

export interface SubscriptionCollection {
  /** Raise the charge that settles one due cycle without an instrument. */
  collectByPush(cycleId: string): Promise<CollectionResult>;
  /**
   * Charge one due cycle against the card on file (FUT-340). `options` is the
   * collector's `CardCollectionOptions`, forwarded unchanged; omitted, one
   * payment, merchant-initiated, exactly as before.
   */
  collectByCard(cycleId: string, options?: CardCollectionOptions): Promise<CollectionResult>;
}

export interface SubscriptionCollectionDeps extends BillingPlatformDeps {
  /**
   * The host's cycle rows, built per call.
   *
   * A factory rather than a value because a host builds its store over a
   * database client it resolves lazily — the same reason `payments` is one.
   */
  cycles: CycleStoreFactory;
  /** Which instrument this subscription can be charged with, at one provider. */
  instruments: InstrumentLookup;
  /** Optional: the cycle's persisted breakdown, checked before every charge. */
  breakdowns?: CycleBreakdownLookup;
}

export function createSubscriptionCollection(
  deps: SubscriptionCollectionDeps,
): SubscriptionCollection {
  /** The collector, built per call over this request's stores. */
  async function collector() {
    const { credentials, gateway } = await deps.payments();
    return createCycleCollector({
      gateway,
      credentials,
      cycles: guarded(await deps.cycles(), deps.breakdowns),
      instruments: deps.instruments,
      merchant: deps.merchant,
      enabled: deps.enabled,
    });
  }

  return {
    async collectByPush(cycleId) {
      return (await collector()).collectByPush(cycleId);
    },
    async collectByCard(cycleId, options) {
      return (await collector()).collectByCard(cycleId, options);
    },
  };
}

/** The host's store, with every chargeable read held to its breakdown. */
function guarded(store: CycleStore, breakdowns: CycleBreakdownLookup | undefined): CycleStore {
  if (!breakdowns) return store;
  return {
    async read(cycleId) {
      const row = await store.read(cycleId);
      if (typeof row === "string") return row;
      // A row the collector skips as already charged stays a skip.
      if (row.providerChargeId !== null) return row;
      const breakdown = await breakdowns(cycleId);
      if (breakdown) assertBreakdownCharges(cycleId, breakdown, row.cycle.amount);
      return row;
    },
    recordRaised: (cycleId, charge) => store.recordRaised(cycleId, charge),
  };
}

function assertBreakdownCharges(
  cycleId: string,
  breakdown: CycleCharge,
  amount: { amountCents: number; currency: string },
): void {
  checkBreakdown(breakdown);
  if (breakdown.amountCents !== amount.amountCents || breakdown.currency !== amount.currency) {
    throw new BillingBreakdownError(
      `cycle ${cycleId} charges ${amount.amountCents} ${amount.currency}, but its breakdown states ${breakdown.amountCents} ${breakdown.currency}`,
    );
  }
}
