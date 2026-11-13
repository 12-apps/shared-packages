import { isRequestTimeout, isTransportError } from './failover';
import type { PaymentsGateway } from './gateway';
import type { ChargeQueryStore, StoredCharge } from './ports';
import type { ChargeSnapshot, MerchantRef } from './types';

/**
 * Ask the provider about charges still waiting — the reconciliation nothing
 * else performs (FUT-761, ported from the first adopting host).
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
  /**
   * The gap between two passes of THIS sweep (FUT-4268). Set, the pass that
   * meets a charge inside the last `finalTickMs` of its window is that
   * charge's last: if it still fails with no HTTP answer, it is warned and
   * reported ONCE. Passes at least this far apart never see one charge in the
   * band twice. Unset (the young sweep), no pass is a last one.
   */
  finalTickMs?: number;
}

export interface PendingSweepReport {
  /** Charges examined this pass. */
  checked: number;
  /** Charges the provider confirmed as paid and the host settled. */
  settled: number;
  /** Charges whose re-read or settle threw — an outage, or a provider refusing to answer. */
  failed: number;
  /**
   * Charges the provider reported refused and the host's `decline` port ended
   * (FUT-4401). Present only when the port is wired.
   */
  declined?: number;
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
  /**
   * The HOST's path for a charge the provider now reports DECLINED (FUT-4401)
   * — accepted at charge time (PagBank's `IN_ANALYSIS`/`WAITING`) and refused
   * afterwards. Nothing else turns that answer into an outcome: the webhook
   * reaction and this sweep's `settle` act on PAID only, so the payable sat
   * open and a buyer watching it waited out their screen's whole bound. The
   * host ends it — closes the payable, and tells the screen watching it.
   * A throw counts the item `failed` for this pass and is logged; the sweep
   * does not retry it — a later pass meets it again only if the host's
   * `listPendingCharges` still lists it. Omit to leave a refused charge
   * waiting, as before.
   */
  decline?: (snapshot: ChargeSnapshot, merchant: MerchantRef, charge: StoredCharge) => Promise<void>;
  /** Sweep observability; the package binds no logger. */
  logWarn?: (line: string) => void;
  /** A failure with no HTTP answer, which the next pass retries (FUT-4268). Never a warning. */
  logInfo?: (line: string) => void;
}

const DEFAULT_GRACE_MS = 2 * 60_000;
const DEFAULT_ABANDON_AFTER_MS = 24 * 60 * 60_000;
const DEFAULT_BATCH = 40;
/** One provider read's deadline: a stuck call must not hold the sweep's lease (FUT-4268). */
const REFRESH_TIMEOUT_MS = 15_000;

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

  const report: PendingSweepReport = { checked: askable.length, settled: 0, failed: 0, ...(deps.decline ? { declined: 0 } : {}) };
  for (const charge of askable) {
    const last = options.finalTickMs !== undefined && charge.createdAt.getTime() <= options.now.getTime() - (abandon - options.finalTickMs);
    tally(report, await reconcileOne(deps, charge, last));
  }
  return report;
}

/** Count one charge's outcome; `waiting` counts nothing. */
function tally(report: PendingSweepReport, outcome: 'settled' | 'declined' | 'waiting' | 'failed'): void {
  if (outcome === 'waiting') return;
  report[outcome] = (report[outcome] ?? 0) + 1;
}

/** Re-read ONE charge; settle it if the provider says PAID, end it if DECLINED. Never throws. */
async function reconcileOne(
  deps: PendingSweepDeps,
  charge: StoredCharge,
  last: boolean,
): Promise<'settled' | 'declined' | 'waiting' | 'failed'> {
  try {
    const signal = AbortSignal.timeout(REFRESH_TIMEOUT_MS);
    // The deadline acts ONLY through the signal: an adapter that honours it has
    // its request aborted; one that ignores it is awaited, because abandoning a
    // read that later answers PAID would leave the charge stored PAID and never
    // listed again, with its order unsettled.
    const snapshot = await deps.gateway.refreshCharge(
      charge.merchant,
      charge.provider,
      charge.providerChargeId,
      undefined,
      { signal, transport: last ? 'final' : 'quiet' },
    );
    if (snapshot?.status === 'DECLINED' && deps.decline) {
      await deps.decline(snapshot, charge.merchant, charge);
      return 'declined';
    }
    if (snapshot?.status !== 'PAID') return 'waiting';
    await deps.settle(snapshot, charge.merchant, charge);
    return 'settled';
  } catch (error) {
    logFailure(deps, charge, error, last);
    return 'failed';
  }
}

/** Charges already warned about in this process; bounded so a long-lived process cannot grow it forever. */
const warnedCharges = new Set<string>();
const WARNED_CHARGES_CAP = 1_000;

/**
 * No HTTP answer is the network's, not the charge's: the next pass asks again,
 * so only the pass that will not is a warning (FUT-4268).
 *
 * And a charge that keeps failing the same way is one problem: it is warned
 * about ONCE per process, and every later pass logs at info. One InfinitePay
 * charge stuck this way warned on every sweep, 376 times in 14 days, against an
 * error-tracker quota that ran out (FUT-3968).
 */
function logFailure(deps: PendingSweepDeps, charge: StoredCharge, error: unknown, last: boolean): void {
  const line =
    `[payments] pending-charge sweep could not reconcile ${charge.provider} ` +
    `${charge.providerChargeId} (${charge.merchant.kind}:${charge.merchant.id}): ` +
    `${error instanceof Error ? error.message : String(error)}`;
  if ((isTransportError(error) || isRequestTimeout(error)) && !last) return deps.logInfo?.(line);
  const key = `${charge.provider}:${charge.providerChargeId}`;
  if (warnedCharges.has(key)) return deps.logInfo?.(line);
  if (warnedCharges.size >= WARNED_CHARGES_CAP) warnedCharges.clear();
  warnedCharges.add(key);
  deps.logWarn?.(line);
}

/** Forget which charges were warned about. Tests only. */
export function resetSweepWarnings(): void {
  warnedCharges.clear();
}
