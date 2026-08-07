import type { MerchantRef, Money, PaymentMethodKind } from './types';
import type { StoredCharge } from './ports';

/**
 * The reads a CHECKOUT needs, which `ChargeStore` never exposed (FUT-740).
 *
 * Every host that mounted this library re-implemented these against the
 * package-OWNED charge table — future-pay ran `prisma.paymentCharge`
 * `count`/`findFirst`/`findMany` directly, reaching around the port into the
 * library's own storage, because the port could not answer "how many attempts
 * has this payable had" or "is there still a payable charge on it". Those are
 * not host questions: the answers decide the idempotency key (FUT-377) and
 * whether a re-tap mints a SECOND payable QR (FUT-379), which are this
 * library's money rules and belong nowhere else.
 *
 * SEPARATE FROM `ChargeStore` on purpose. Adding required members to a
 * published storage interface breaks every hand-rolled implementation at
 * typecheck, and a host that only mounts the settings surface owes these
 * queries nothing. `createPaymentFlowsBE` asks for `ChargeStore & ChargeQueryStore`,
 * so the mount that NEEDS them demands them and nothing else does. Both shipped
 * implementations (`prisma/stores.ts`, `memory.ts`) satisfy the pair.
 */
export interface PayableChargeQuery {
  merchant: MerchantRef;
  /**
   * The payable's BASE reference. Implementations must match it exactly OR
   * with a `--<attempt>` suffix — see `core/reference.ts` for why a bare
   * prefix match reaches another payable's charges.
   */
  reference: string;
  /** Restrict to one method. Omitted means any. */
  method?: PaymentMethodKind;
  /** Only charges at exactly this price. Mutually exclusive with `amountNot`. */
  amount?: Money;
  /** Only charges at some OTHER price — what a reprice left behind. */
  amountNot?: Money;
}

export interface ChargeQueryStore {
  /**
   * How many charges this payable has ALREADY persisted — the ordinal of the
   * next attempt, and the only moving part of its idempotency key (FUT-377).
   *
   * Counting PERSISTED charges is what makes the key mean "attempt", not
   * "payable": an attempt that produced a charge bumps the count so the next
   * one gets a fresh key and a fresh charge (which a reprice and a second card
   * both need), while an attempt that produced NOTHING leaves it unchanged so
   * the retry reuses the key and the provider — or this package's own store —
   * dedupes it instead of charging twice.
   */
  countByReference(merchant: MerchantRef, reference: string): Promise<number>;
  /**
   * The payable's still-PAYABLE charges — `PENDING` only — newest first.
   *
   * `PENDING` is the whole point: a settled, failed, cancelled or expired
   * charge is not something a buyer can pay, so it can neither be handed back
   * on a re-tap nor be worth voiding after a reprice. Everything finer than
   * that (a live QR, a live hosted link, a stale price) is decided by
   * `checkout/reuse.ts` from the snapshots this returns.
   */
  listPayable(query: PayableChargeQuery): Promise<StoredCharge[]>;
}
