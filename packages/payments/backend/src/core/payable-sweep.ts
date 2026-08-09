import type { PaymentsGateway } from './gateway';
import type { ChargeQueryStore, StoredCharge } from './ports';
import type { ChargeSnapshot, MerchantRef } from './types';

/**
 * Ask the provider about charges still waiting — the reconciliation nothing
 * else performs (FUT-761, ported from the future-pay host).
 *
 * Three things can settle a charge, and only one runs on its own: the
 * provider's webhook; a status poll driven by the BUYER'S OPEN TAB; and a
 * human confirming in person. The webhook replay looks like a fourth and is
 * not — its only input is the inbox, so it can finish a delivery that
 * arrived and failed, never invent one that never came. So a paid charge
 * whose webhook went missing was rescued only while the buyer kept the
 * screen open; close the tab and nothing, anywhere, ever asked the provider
 * again. This is that missing machine. It fixes a dropped webhook, an
 * outage, a misconfigured callback URL and a provider that simply never
 * calls, without knowing which of them happened.
 *
 * It decides nothing itself: it re-reads through `gateway.refreshCharge`
 * (which persists what it read) and hands a PAID snapshot to the HOST's
 * `settle` port — the same idempotent path the webhook takes, carrying the
 * amount the provider says it CAPTURED, so the host's shortfall guard still
 * applies and a double-apply stays impossible.
 */

export interface PendingChargeWindow {
  /** Only charges CREATED BEFORE this instant — the buyer's own poll covers younger ones. */
  before: Date;
  /**
   * And AFTER this one. A charge nobody settled past the window is not a
   * delayed webhook, it is an incident: polling it forever would spend real
   * provider quota on rows that need a human. They stay put, unchanged, for
   * the report they deserve.
   */
  after: Date;
  /** Per-pass bound, so one sweep can never become an unbounded fan-out. */
  limit: number;
}

export interface PendingSweepOptions {
  now: Date;
  /** Ignore charges younger than this (default 2 min — the buyer's poll is faster). */
  graceMs?: number;
  /** Stop asking about charges older than this (default 24 h — an incident, not a delay). */
  abandonAfterMs?: number;
  /** Per-pass bound (default 40). */
  batch?: number;
}

export interface PendingSweepReport {
  /** Charges examined this pass. */
  checked: number;
  /** Charges the provider confirmed as paid and the host settled. */
  settled: number;
  /** Charges whose re-read or settle threw — an outage, or a provider refusing to answer. */
  failed: number;
}

export interface PendingSweepDeps {
  /** Must implement `listPendingCharges` — the cross-merchant pending read. */
  charges: ChargeQueryStore;
  gateway: Pick<PaymentsGateway, 'refreshCharge'>;
  /**
   * The HOST's settle path for a charge the provider reports PAID — the same
   * idempotent machinery its webhook reaction uses (order confirmation,
   * subscription cycle, activation proof). Throw to count the item failed;
   * the sweep itself never throws.
   */
  settle: (snapshot: ChargeSnapshot, merchant: MerchantRef, charge: StoredCharge) => Promise<void>;
  /** Sweep observability; the package binds no logger. */
  logWarn?: (line: string) => void;
}

const DEFAULT_GRACE_MS = 2 * 60_000;
const DEFAULT_ABANDON_AFTER_MS = 24 * 60 * 60_000;
const DEFAULT_BATCH = 40;

/**
 * One reconciliation pass. Never throws: a provider outage must not fail the
 * sweep, and the next pass simply asks again. Each charge is independent, so
 * one unreachable provider cannot stop the others being settled.
 */
export async function reconcilePendingCharges(
  deps: PendingSweepDeps,
  options: PendingSweepOptions,
): Promise<PendingSweepReport> {
  const list = deps.charges.listPendingCharges;
  if (!list) {
    throw new Error(
      '[payments] reconcilePendingCharges needs a ChargeQueryStore with listPendingCharges — ' +
        'the provided store does not implement the cross-merchant pending read.',
    );
  }
  const grace = options.graceMs ?? DEFAULT_GRACE_MS;
  const abandon = options.abandonAfterMs ?? DEFAULT_ABANDON_AFTER_MS;
  const pending = await list.call(deps.charges, {
    before: new Date(options.now.getTime() - grace),
    after: new Date(options.now.getTime() - abandon),
    limit: options.batch ?? DEFAULT_BATCH,
  });

  // A stub charge is a dev/CI fixture whose simulated timeline belongs to the
  // status poll; the sweep must not race it.
  const askable = pending.filter((charge) => !charge.providerChargeId.startsWith('stub_'));

  const report: PendingSweepReport = { checked: askable.length, settled: 0, failed: 0 };
  for (const charge of askable) {
    const outcome = await reconcileOne(deps, charge);
    if (outcome === 'settled') report.settled += 1;
    if (outcome === 'failed') report.failed += 1;
  }
  return report;
}

/** Re-read ONE charge; settle it if the provider says PAID. Never throws. */
async function reconcileOne(
  deps: PendingSweepDeps,
  charge: StoredCharge,
): Promise<'settled' | 'waiting' | 'failed'> {
  try {
    const snapshot = await deps.gateway.refreshCharge(
      charge.merchant,
      charge.provider,
      charge.providerChargeId,
    );
    if (snapshot?.status !== 'PAID') return 'waiting';
    await deps.settle(snapshot, charge.merchant, charge);
    return 'settled';
  } catch (error) {
    deps.logWarn?.(
      `[payments] pending-charge sweep could not reconcile ${charge.provider} ` +
        `${charge.providerChargeId} (${charge.merchant.kind}:${charge.merchant.id}): ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return 'failed';
  }
}
