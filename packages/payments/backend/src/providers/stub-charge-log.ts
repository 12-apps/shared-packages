import type { ChargeInput, ProviderName } from '../core/types';

/**
 * What a STUB provider was asked to charge — the far end of the wire, recorded
 * for a host running the packaged journeys (FUT-3627, `@12-apps/payments-e2e`).
 *
 * Those journeys assert on what a provider RECEIVED, not on what the browser
 * says it sent: that the CPF reached it, that a card instrument was minted for
 * each provider of a chain, that a wallet charge carried the wallet. The
 * harness reads its in-page adapters for that; a real host runs this package's
 * stub, so the stub keeps the record and the host only reads it — through
 * whatever test-only surface it already guards (a State API, say).
 *
 * Written ONLY by `stubCharge`, which runs only under `credentials.stub` — a
 * flag derived from the deployment's own stub policy, never accepted from a
 * caller. A live charge never reaches it. In memory and bounded: a test process
 * is short, and nothing here is evidence anyone keeps.
 */

/** One charge a stub provider received. */
export interface StubChargeRecord {
  provider: ProviderName;
  /** The host reference the charge was raised under (the order). */
  reference: string;
  method: string;
  /** The buyer's tax id exactly as the provider received it, or `''`. */
  taxId: string;
  /** `tok:<token>`, `wallet:<type>`, or `(no-instrument)` — what THIS provider was handed. */
  instrument: string;
}

/** Enough for a whole e2e run; the oldest records go first. */
const LIMIT = 500;

const records: StubChargeRecord[] = [];

function instrumentOf(provider: ProviderName, input: ChargeInput): string {
  const card = input.card;
  if (card?.wallet) return `wallet:${card.wallet.type}`;
  const token = card?.tokensByProvider?.[provider] ?? card?.token;
  return token ? `tok:${token}` : '(no-instrument)';
}

/**
 * Record one charge a stub was asked for. Called BEFORE any scripted fault
 * fires, so a head scripted to refuse still counts as having received the
 * charge — which is exactly what a failover journey asserts.
 */
export function recordStubCharge(provider: ProviderName, input: ChargeInput): void {
  records.push({
    provider,
    reference: input.reference,
    method: input.method,
    taxId: input.customer.taxId ?? '',
    instrument: instrumentOf(provider, input),
  });
  if (records.length > LIMIT) records.splice(0, records.length - LIMIT);
}

/** The recorded stub charges raised under any of `references`, oldest first. */
export function stubChargesFor(references: ReadonlySet<string>): StubChargeRecord[] {
  return records.filter((record) => references.has(record.reference));
}
