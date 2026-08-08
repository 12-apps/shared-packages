import { resolvedFrom } from '../config/enablement';
import type { ProviderConfigStore } from '../config/types';
import type { SettingsService } from '../config/service';
import type { ChargeStore } from '../core/ports';
import type { PaymentProviderAdapter } from '../core/provider';
import type { ProviderRegistry } from '../core/registry';
import type { MerchantRef, ResolvedCredentials } from '../core/types';
import {
  isCardAttemptRecord,
  probeLostCardAttempt,
  refundCent,
  type LostCardAttempt,
} from './card-attempt';
import { ownsVerificationReference } from './reference';

/**
 * Stamp activation charges that PAID without their proof landing (FUT-463).
 *
 * A config still HOLDING `pending_verification` while its activation payment
 * is already confirmed is a settlement that half-landed: the money moved, the
 * provider confirmed it, and `charge_verified_at` never got stamped. The
 * webhook inbox remembers the delivery as settled — correct by its own rules —
 * so the provider's redelivery (and a manual replay) is dedup-skipped forever.
 * Nothing else will ever come back for these rows; this module is the machine
 * that does — as a periodic sweep, and inline when a settings screen reads the
 * outstanding charge.
 *
 * ## What counts as proof
 *
 * For a REDIRECT row, never the provider, asked fresh: confirming a
 * hosted-checkout payment can demand correlation values (a transaction id, an
 * invoice code) that exist only in the buyer's return trip and the delivery —
 * precisely what a stranded row no longer has. What it DOES have is one of
 * two durable records this system already verified:
 *
 *   - a stored charge for the activation reference in PAID — written wherever
 *     a stored charge existed to update;
 *   - a PROCESSED webhook inbox row whose payload names the reference — but
 *     only for a provider whose adapter declares `verifyConfirmsPayment`:
 *     its webhook `verify` re-asks the provider whether the money moved, so
 *     PROCESSED means the provider itself confirmed the payment before the
 *     row settled. Every other adapter's verify proves the SENDER, not the
 *     payment, so its inbox rows prove nothing here. WHICH charge the payload
 *     names is the adapter's own `referenceOfDelivery`, declared in the same
 *     breath as the flag (FUT-726) — the correlation key is a fact about that
 *     provider's payload shape, and a parse of one vendor's field out here
 *     would answer confidently and wrongly for the second adapter to arrive.
 *
 * ## The CARD exception (FUT-679)
 *
 * A card verification attempt whose `createCharge` answer was LOST leaves
 * NEITHER durable record, ever: the charge is raised through the adapter
 * directly (nothing stored to update), and a signature-verifying provider's
 * inbox rows prove nothing. What it has instead is exactly what a redirect
 * row lacks: its reference alone is sufficient correlation, because it is the
 * key the adapter indexed the order under at creation — the precise contract
 * of `findChargeByReference`. So for a pending row the card flow marked
 * (`phase: 'CARD'`), the sweep MAY ask the provider — and then it must not
 * merely stamp but CURE: refund the stranded cent when it was paid, apply the
 * activation the charge proved, or release a row the provider says holds no
 * live charge. Never forget the cent; never guess on an unanswered question.
 */

/** Per-pass bound, so one sweep can never become an unbounded fan-out. */
const BATCH = 25;

export interface ActivationReport {
  /** Configs holding an outstanding activation charge. */
  checked: number;
  /** Proofs stamped this pass. */
  stamped: number;
}

/** One config's outstanding activation charge, as the host's store reports it. */
export interface OutstandingActivation {
  merchant: MerchantRef;
  provider: string;
  /** The pending row's STORED reference, or null when it holds none. */
  reference: string | null;
}

/**
 * The two durable-proof reads the package cannot own: both are cross-row
 * queries over the HOST's persistence (its config table, its webhook inbox),
 * shaped by indexes the host controls. The host implements this; the sweep's
 * decisions — ownership, what counts as proof — stay here.
 */
export interface ActivationProofStore {
  /**
   * Unproven configs with an activation charge outstanding
   * (`chargeVerifiedAt` null, a pending-verification row present), at most
   * `limit`.
   */
  listOutstanding(limit: number): Promise<OutstandingActivation[]>;
  /**
   * The RAW payload of a PROCESSED delivery recorded for this merchant and
   * provider whose body contains `reference` — the index-friendly narrowing.
   * The parse is the decision, and it happens here via the adapter.
   */
  findProcessedDeliveryPayload(
    merchant: MerchantRef,
    provider: string,
    reference: string,
  ): Promise<string | null>;
}

export interface ActivationLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** Everything a reconcile pass reads and writes, all host-wired. */
export interface ActivationReconcileContext {
  providers: ProviderRegistry;
  /**
   * The pending-row pair joined `applyChargeVerification` for the CARD cure
   * (FUT-679): the sweep reads the row to see the card flow's `phase` marker,
   * and releases a row the provider says holds no live charge. A host passing
   * its whole settings service (the wiring in practice) needs no change.
   */
  settings: Pick<
    SettingsService,
    'applyChargeVerification' | 'getPendingVerification' | 'setPendingVerification'
  >;
  config: Pick<ProviderConfigStore, 'get'>;
  charges: Pick<ChargeStore, 'findByProviderChargeId'>;
  proofs: ActivationProofStore;
  /**
   * Whether this deployment may resolve stub credentials as stub — same
   * contract as `ActivationContext.allowStubMode`, from
   * `resolveStubMode(process.env)`, never inferred. Defaults to OFF.
   */
  allowStubMode?: boolean;
  log?: ActivationLogger;
}

interface Stranded {
  merchant: MerchantRef;
  provider: string;
  /** The activation reference, `verify-<provider>-<merchantId>[--attempt]`. */
  reference: string;
}

/**
 * Unproven configs with an activation charge outstanding.
 *
 * The STORED reference is used, not a rebuilt one — it now carries an attempt
 * id — but it is still checked against the row's own identity, so it cannot
 * name another merchant's connection (FUT-463); rows whose stored reference
 * disagrees are skipped.
 */
async function listStranded(ctx: ActivationReconcileContext): Promise<Stranded[]> {
  const rows = await ctx.proofs.listOutstanding(BATCH);
  return rows.flatMap((row) => {
    const { merchant, provider, reference } = row;
    if (!reference || !ownsVerificationReference(reference, provider, merchant.id)) return [];
    return [{ merchant, provider, reference }];
  });
}

/** Whether a stored charge for this activation reference is settled. */
async function chargeLanded(ctx: ActivationReconcileContext, stranded: Stranded): Promise<boolean> {
  const charge = await ctx.charges.findByProviderChargeId(stranded.provider, stranded.reference);
  if (!charge) return false;
  // The charge must belong to the merchant whose config it would prove — the
  // same ownership rule the webhook pipeline's upsert enforces.
  const owner = charge.merchant;
  if (owner.kind !== stranded.merchant.kind || owner.id !== stranded.merchant.id) return false;
  return charge.snapshot.status === 'PAID' || charge.snapshot.status === 'AUTHORIZED';
}

/**
 * Whether a VERIFIED delivery for this reference was processed — and whether
 * that even counts.
 *
 * This is the proof the activation charge usually leaves: it is raised through
 * the adapter directly, so there is no stored charge for the delivery to
 * update — `upsertByProviderChargeId` updates and never creates. Gated on the
 * adapter's own `verifyConfirmsPayment` declaration, deliberately: only a
 * provider whose webhook `verify` re-asks the provider itself makes PROCESSED
 * mean "the provider confirmed the payment". A signature-verified provider's
 * PROCESSED row proves who sent it, not that money moved.
 *
 * The payload's correlation key is read by the ADAPTER (`referenceOfDelivery`,
 * FUT-726): the reference must be the delivery's own key, not a substring that
 * happened to appear somewhere in the body — `listOutstanding`'s `contains` is
 * only the index-friendly narrowing. The two declarations are a SINGLE union
 * member on the adapter, so the flag cannot arrive alone: there is no adapter
 * whose rows count as proof and which has no way to say what they prove.
 */
async function confirmedDeliveryLanded(
  ctx: ActivationReconcileContext,
  stranded: Stranded,
): Promise<boolean> {
  const adapter = ctx.providers.has(stranded.provider) ? ctx.providers.get(stranded.provider) : null;
  if (!adapter?.verifyConfirmsPayment) return false;
  const payload = await ctx.proofs.findProcessedDeliveryPayload(
    stranded.merchant,
    stranded.provider,
    stranded.reference,
  );
  if (payload === null) return false;
  return adapter.referenceOfDelivery(payload) === stranded.reference;
}

/** Apply the proven activation — the one door to `chargeVerifiedAt` here. */
async function stamp(ctx: ActivationReconcileContext, stranded: Stranded): Promise<boolean> {
  await ctx.settings.applyChargeVerification(stranded.merchant, stranded.provider, true);
  ctx.log?.info(
    `payments.reconcile-activations stamped ${stranded.provider} for ${stranded.merchant.id}`,
  );
  return true;
}

/**
 * Stamp one stranded activation if either durable proof exists — and when
 * neither ever can (a CARD attempt, FUT-679), cure it through the provider.
 */
async function settleIfProven(
  ctx: ActivationReconcileContext,
  stranded: Stranded,
): Promise<boolean> {
  if ((await chargeLanded(ctx, stranded)) || (await confirmedDeliveryLanded(ctx, stranded))) {
    return stamp(ctx, stranded);
  }
  return cureLostCardAttempt(ctx, stranded);
}

/**
 * The CARD cure: resolve a stranded card attempt by asking the provider what
 * its reference became — see the module note on why this row alone may be
 * asked fresh. Only rows the card flow itself marked (`phase: 'CARD'`) and
 * only through an adapter that declares `findChargeByReference`; everything
 * else answers false untouched, keeping the redirect lifecycle exactly as it
 * was.
 */
async function cureLostCardAttempt(
  ctx: ActivationReconcileContext,
  stranded: Stranded,
): Promise<boolean> {
  const pending = await ctx.settings.getPendingVerification(stranded.merchant, stranded.provider);
  // Re-read from the row rather than trusted from the sweep's listing: the
  // attempt may have settled between the listing and this pass.
  if (!pending || pending.reference !== stranded.reference || !isCardAttemptRecord(pending)) {
    return false;
  }
  const adapter = ctx.providers.has(stranded.provider) ? ctx.providers.get(stranded.provider) : null;
  if (!adapter?.findChargeByReference) return false;
  const stored = await ctx.config.get(stranded.merchant, stranded.provider);
  if (!stored) return false;

  const credentials = resolvedFrom(stored, ctx.allowStubMode ?? false);
  const outcome = await probeLostCardAttempt(adapter, stranded.reference, credentials);
  return applyCardCure(ctx, stranded, adapter, credentials, outcome);
}

/**
 * Act on what the provider said the stranded cent became. PROVEN both cures
 * AND stamps: the money moved through this connection, which is the exact
 * fact activation exists to establish — and the cent is refunded first, so it
 * is never forgotten even though the attempt's own refund never ran.
 */
async function applyCardCure(
  ctx: ActivationReconcileContext,
  stranded: Stranded,
  adapter: PaymentProviderAdapter,
  credentials: ResolvedCredentials,
  outcome: LostCardAttempt,
): Promise<boolean> {
  if (outcome.kind === 'PROVEN') {
    await refundStrandedCent(ctx, stranded, adapter, credentials, outcome);
    return stamp(ctx, stranded);
  }
  if (outcome.kind === 'GONE' || outcome.kind === 'DECLINED') {
    return releaseDeadAttempt(ctx, stranded, outcome.kind);
  }
  if (outcome.kind === 'UNANSWERED') {
    ctx.log?.warn(
      `payments.reconcile-activations could not resolve card attempt for ${stranded.provider} ` +
        `(${stranded.merchant.id}): ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`,
    );
  }
  // OPEN or UNANSWERED: nothing settled — the row stays; the next pass asks again.
  return false;
}

/** Give the found cent back — best effort, reported when it cannot be. */
async function refundStrandedCent(
  ctx: ActivationReconcileContext,
  stranded: Stranded,
  adapter: PaymentProviderAdapter,
  credentials: ResolvedCredentials,
  outcome: { providerChargeId: string; alreadyRefunded: boolean },
): Promise<void> {
  if (outcome.alreadyRefunded) return;
  if (await refundCent(adapter, outcome.providerChargeId, credentials)) return;
  ctx.log?.warn(
    `payments.reconcile-activations could not refund verification cent ` +
      `${outcome.providerChargeId} (${stranded.provider}, ${stranded.merchant.id})`,
  );
}

/**
 * The provider's own word that no live charge exists behind this reference
 * (never created, expired, or its decline arrived late): release the row so
 * the screen stops resuming a dead attempt and a retry starts clean.
 */
async function releaseDeadAttempt(
  ctx: ActivationReconcileContext,
  stranded: Stranded,
  kind: 'GONE' | 'DECLINED',
): Promise<boolean> {
  await ctx.settings.setPendingVerification(stranded.merchant, stranded.provider, null);
  ctx.log?.info(
    `payments.reconcile-activations released ${kind === 'DECLINED' ? 'declined' : 'chargeless'} ` +
      `card attempt for ${stranded.provider} (${stranded.merchant.id})`,
  );
  return false;
}

/**
 * Heal ONE merchant's outstanding activation, now — a settings screen calls
 * this when it reads a pending charge, so a stranded proof lands the moment
 * the owner looks, without waiting on the sweep (or on a worker existing).
 *
 * Guarded exactly like the sweep: the pending row's reference must be the one
 * this config's own identity derives, and an already-proven config is left
 * alone — healing must never switch a paused-but-proven provider back on.
 * For a CARD row this includes the provider-poll cure (FUT-679), so a
 * stranded cent is found the moment the owner opens the screen.
 */
export async function healStrandedActivation(
  ctx: ActivationReconcileContext,
  merchant: MerchantRef,
  provider: string,
  pendingReference: string,
): Promise<boolean> {
  if (!ownsVerificationReference(pendingReference, provider, merchant.id)) return false;
  const config = await ctx.config.get(merchant, provider);
  if (!config || config.chargeVerifiedAt) return false;
  return settleIfProven(ctx, { merchant, provider, reference: pendingReference });
}

/**
 * One pass. Never throws: each row is independent, and the next pass is the
 * retry.
 */
export async function reconcileActivationCharges(
  ctx: ActivationReconcileContext,
): Promise<ActivationReport> {
  const stranded = await listStranded(ctx);
  const report: ActivationReport = { checked: stranded.length, stamped: 0 };

  for (const row of stranded) {
    try {
      if (await settleIfProven(ctx, row)) report.stamped += 1;
    } catch (error) {
      ctx.log?.warn(
        `payments.reconcile-activations could not settle ${row.provider} for ${row.merchant.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return report;
}
