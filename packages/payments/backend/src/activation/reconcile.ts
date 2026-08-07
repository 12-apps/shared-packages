import type { ProviderConfigStore } from '../config/types';
import type { SettingsService } from '../config/service';
import type { ChargeStore } from '../core/ports';
import type { ProviderRegistry } from '../core/registry';
import type { MerchantRef } from '../core/types';
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
 * Never the provider, asked fresh: confirming a hosted-checkout payment can
 * demand correlation values (a transaction id, an invoice code) that exist
 * only in the buyer's return trip and the delivery — precisely what a
 * stranded row no longer has. What it DOES have is one of two durable records
 * this system already verified:
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
  settings: Pick<SettingsService, 'applyChargeVerification'>;
  config: Pick<ProviderConfigStore, 'get'>;
  charges: Pick<ChargeStore, 'findByProviderChargeId'>;
  proofs: ActivationProofStore;
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

/** Stamp one stranded activation if either durable proof exists. */
async function settleIfProven(
  ctx: ActivationReconcileContext,
  stranded: Stranded,
): Promise<boolean> {
  if (!(await chargeLanded(ctx, stranded)) && !(await confirmedDeliveryLanded(ctx, stranded))) {
    return false;
  }
  await ctx.settings.applyChargeVerification(stranded.merchant, stranded.provider, true);
  ctx.log?.info(
    `payments.reconcile-activations stamped ${stranded.provider} for ${stranded.merchant.id}`,
  );
  return true;
}

/**
 * Heal ONE merchant's outstanding activation, now — a settings screen calls
 * this when it reads a pending charge, so a stranded proof lands the moment
 * the owner looks, without waiting on the sweep (or on a worker existing).
 *
 * Guarded exactly like the sweep: the pending row's reference must be the one
 * this config's own identity derives, and an already-proven config is left
 * alone — healing must never switch a paused-but-proven provider back on.
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
