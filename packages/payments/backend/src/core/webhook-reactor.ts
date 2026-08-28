import { baseReference } from './reference';
import { classifyReversalEvent } from './reversal';
import type { MerchantRef } from './types';
import type { NormalizedWebhookEvent } from './webhook-event-types';
import type { StoredCharge, WebhookEventHandler } from './ports';

/**
 * What a verified webhook DOES, once the delivery is known to be real
 * (FUT-764).
 *
 * The package already normalized the event, verified it against the merchant's
 * own secret, and classified a reversal. What it stopped short of was the FAN-IN
 * — the order the reactions run in, and which of them may consume a delivery —
 * so every host wrote that itself. It is not host knowledge: every rule below
 * is a property of the webhook contract, and each one is a payment that went
 * wrong before it was written down.
 *
 * The five rules, in the order they must run:
 *
 * 1. **A parked legacy notification resolves first**, and each event it yields
 *    takes the same reactions. Their `charge` is null by construction: a legacy
 *    transaction code keys no stored charge row, so correlation is by the host
 *    reference the resolver preserved.
 * 2. **Reversal before settlement.** A `CHARGE_UPDATED` carrying `REFUNDED`
 *    must never be able to read as anything but money leaving.
 * 3. **The activation charge settles before everything else.** It is raised
 *    through the adapter directly, so it has no stored charge and no payable —
 *    and a guard written for those two facts drops it silently.
 * 4. **No stored charge is not "no payment".** The caller used to give up
 *    there, and that is how a real payment went missing: the buyer paid, the
 *    provider said so, and the reaction was dropped because OUR row was absent.
 *    Most sharply for a provider whose charge id IS the reference, where a
 *    second attempt collides with the first and can never be stored.
 * 5. **Branch on the MERCHANT, never on the reference's shape.** PLATFORM is a
 *    tenant paying the platform; TENANT is a shopper paying a store. Both
 *    references are opaque ids, so a shape test is a guess — while the merchant
 *    is what the credential store already resolved to verify this delivery, and
 *    is the half a payload cannot forge. Before that branch existed, a
 *    subscription confirmation was handed to the order path as an order id and
 *    settled nothing, silently.
 *
 * Every reference that reaches a port is resolved against the VERIFIED
 * merchant, so one naming another store's payable resolves to nothing.
 */

/** What the host does with a confirmed payment against one of its payables. */
export interface WebhookReactorPorts {
  /**
   * Settle the host's own payable. Must be idempotent on `providerChargeId` —
   * a webhook and a reconciliation sweep race each other routinely.
   */
  settlePayable(input: {
    reference: string;
    providerChargeId: string;
    method: 'PIX' | 'CARD';
    amountCents: number;
  }): Promise<void>;
  /**
   * Is this reference a payable this merchant can still settle? Answering
   * `false` for one already settled is what keeps rule 4 idempotent alongside
   * the host's own exactly-once guarantee.
   */
  payableIsOpen(merchant: MerchantRef, reference: string): Promise<boolean>;
  /**
   * Settle the PLATFORM direction — a tenant's subscription payment. Absent
   * means this host has no platform direction, and such a delivery is ignored
   * rather than misrouted into the payable path.
   */
  settlePlatformPayment?(input: {
    reference: string;
    amountCents: number;
    providerChargeId: string;
  }): Promise<void>;
  /** Money left: take the payable out of settled, however this host spells it. */
  parkReversal(
    facts: { reference: string; providerChargeId: string; refundedCents: number },
    merchant: MerchantRef,
  ): Promise<void>;
  /** Money HELD, neither outcome decided. Recorded without moving the payable. */
  recordDispute(
    // Both ids are nullable: a dispute can arrive naming neither the payable
    // nor the charge, and it is still news worth recording — a dispute nobody
    // hears about is lost by default.
    facts: { reference: string | null; providerChargeId: string | null; eventId: string },
    merchant: MerchantRef,
  ): Promise<void>;
  /**
   * The activation charge, if this host runs one. Returns true when the
   * delivery was one and has been consumed.
   */
  settleActivation?(
    providerChargeId: string,
    merchant: MerchantRef,
    provider: string,
  ): Promise<boolean>;
  /**
   * Parked legacy notifications this delivery resolves, if the host has any.
   * Returning a non-empty list consumes the original event in its favour.
   */
  resolveLegacyEvents?(
    event: NormalizedWebhookEvent,
    merchant: MerchantRef,
  ): Promise<NormalizedWebhookEvent[] | null>;
  /**
   * The stored charge row's reference for a provider charge id, scoped to the
   * merchant — the fallback when a reversal names none. Reading this package's
   * own table, so a host that has one need not re-derive the ownership scope.
   */
  referenceOf?(
    merchant: MerchantRef,
    provider: string,
    providerChargeId: string,
  ): Promise<string | null>;
}

export function createWebhookReactor(ports: WebhookReactorPorts): WebhookEventHandler {
  return async (event, charge, merchant) => {
    // Rule 1.
    const resolved = await ports.resolveLegacyEvents?.(event, merchant);
    if (resolved && resolved.length > 0) {
      for (const legacy of resolved) await react(ports, legacy, null, merchant);
      return;
    }
    await react(ports, event, charge, merchant);
  };
}

/** Rule 2: reversal first; an unknown event type falls through both. */
async function react(
  ports: WebhookReactorPorts,
  event: NormalizedWebhookEvent,
  charge: StoredCharge | null,
  merchant: MerchantRef,
): Promise<void> {
  if (await applyReversal(ports, event, charge, merchant)) return;
  await applyPaid(ports, event, charge, merchant);
}

/**
 * WHICH payable a reversal names, in the only order that is safe.
 *
 * The event's own reference wins; then the stored charge row's; then this
 * package's table, scoped to the VERIFIED merchant — so a charge id belonging
 * to another store resolves to nothing here, whatever the payload claims.
 */
async function reversalReference(
  ports: WebhookReactorPorts,
  event: NormalizedWebhookEvent,
  reversal: { reference: string | null; providerChargeId: string | null },
  charge: StoredCharge | null,
  merchant: MerchantRef,
): Promise<string | null> {
  if (reversal.reference) return reversal.reference;
  if (charge?.reference) return charge.reference;
  if (!ports.referenceOf || !reversal.providerChargeId) return null;
  return ports.referenceOf(merchant, event.provider, reversal.providerChargeId);
}

async function applyReversal(
  ports: WebhookReactorPorts,
  event: NormalizedWebhookEvent,
  charge: StoredCharge | null,
  merchant: MerchantRef,
): Promise<boolean> {
  // Only the TENANT direction has a payable behind the charge; a refunded
  // subscription payment is left to the host's billing surfaces.
  if (merchant.kind !== 'TENANT') return false;
  const reversal = classifyReversalEvent(event);
  if (!reversal) return false;

  if (reversal.kind === 'DISPUTE') {
    await ports.recordDispute(
      {
        reference: reversal.reference ?? charge?.reference ?? null,
        providerChargeId: reversal.providerChargeId,
        eventId: event.eventId,
      },
      merchant,
    );
    return true;
  }

  const reference = await reversalReference(ports, event, reversal, charge, merchant);
  if (!reference) return false;

  await ports.parkReversal(
    {
      reference,
      providerChargeId: reversal.providerChargeId,
      refundedCents: reversal.refundedCents,
    },
    merchant,
  );
  return true;
}

async function applyPaid(
  ports: WebhookReactorPorts,
  event: NormalizedWebhookEvent,
  charge: StoredCharge | null,
  merchant: MerchantRef,
): Promise<void> {
  const paid = event.charge;
  if (paid?.status !== 'PAID') return;

  // Rule 3.
  if (await ports.settleActivation?.(paid.providerChargeId, merchant, paid.provider)) return;

  // Rule 4.
  if (!charge) {
    if (merchant.kind !== 'TENANT' || !paid.reference) return;
    // The reference may carry a per-attempt suffix; the payable is its prefix.
    const reference = baseReference(paid.reference);
    if (!(await ports.payableIsOpen(merchant, reference))) return;
    await settle(ports, reference, paid);
    return;
  }

  await applyStoredCharge(ports, paid, charge);
}

/**
 * Rule 5, and the one function a reconciliation sweep shares with the webhook.
 *
 * Exported because the webhook is not the only caller: a sweep that re-reads
 * charges the provider never called back about settles them through this same
 * function. That sharing is the point — a second dispatch is a second place for
 * the PLATFORM/TENANT branch to be got wrong, on the money path.
 */
export async function applyStoredCharge(
  ports: WebhookReactorPorts,
  paid: NonNullable<NormalizedWebhookEvent['charge']>,
  charge: StoredCharge,
): Promise<void> {
  if (charge.merchant.kind === 'PLATFORM') {
    await ports.settlePlatformPayment?.({
      reference: charge.reference,
      amountCents: paid.amount.amountCents,
      providerChargeId: paid.providerChargeId,
    });
    return;
  }
  // The stored reference names the payable PLUS the attempt that raised the
  // charge. Passing it whole hands the host an id no payable has, so a payment
  // made on any attempt after the first settles nothing.
  await settle(ports, baseReference(charge.reference), paid);
}

function settle(
  ports: WebhookReactorPorts,
  reference: string,
  paid: NonNullable<NormalizedWebhookEvent['charge']>,
): Promise<void> {
  return ports.settlePayable({
    reference,
    providerChargeId: paid.providerChargeId,
    method: paid.method === 'CARD' ? 'CARD' : 'PIX',
    amountCents: paid.amount.amountCents,
  });
}
