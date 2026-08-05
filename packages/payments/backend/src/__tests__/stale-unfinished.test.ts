import { describe, expect, it } from 'vitest';

import { createPaymentsGateway } from '../core/gateway';
import type { PaymentProviderAdapter } from '../core/provider';
import { defineProviders } from '../core/registry';
import type { ChargeInput, ChargeSnapshot } from '../core/types';
import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
} from '../memory';
import { createMemoryWebhookInbox } from '../memory-webhook-inbox';
import { TENANT, STUB_CREDS } from './fixtures';

/**
 * A LEDGER ROW THAT NAMES SOMEBODY ELSE'S CHARGE (FUT-727).
 *
 * `loadHistory` treats a SUCCEEDED/ADOPTED ledger row with no charge row under
 * the same key as "the provider created it and our write was lost", and
 * `recoverUnfinished` re-reads that charge BY THE LEDGER'S OWN
 * `providerChargeId` — deliberately, since the reference cannot identify a
 * charge the provider has already minted.
 *
 * That inference is sound only while the ledger row's charge belongs to the key
 * it is filed under. FUT-669 broke that for every order alive at the time: the
 * reference used to be the bare order id for EVERY attempt, so a pre-fix
 * attempt 1 ledgered `providerChargeId` = the order id — which is attempt 0's
 * charge. Post-fix the walk still trusts it, re-reads attempt 0's charge,
 * stores it (the store is insert-or-return-existing on
 * `(provider, providerChargeId)`, so it hands back attempt 0's row), and the
 * caller's identity guard refuses a row keyed `:0` for an attempt asking `:1`.
 *
 * The refusal is CORRECT — that guard is what stops a live charge's id landing
 * on another attempt's bookkeeping (FUT-378). What is wrong is arriving there
 * at all, and arriving there again on every single retry, because the bad
 * inference is re-derived from durable data that no deploy changes. Measured in
 * production on 2026-08-05 against an order raised on 2026-07-15:
 *
 *   expected attempt <order>:1, got a charge stored under <order>:0
 *   (infinitepay charge <order>) — nothing recorded
 *
 * The order was three weeks unpayable and would have stayed so forever.
 */

const ORDER = 'ord_95a60f7a';

/** InfinitePay's defining property: the charge id IS the reference we sent. */
function referenceIsChargeId(input: ChargeInput): ChargeSnapshot {
  return {
    provider: 'redirect',
    providerChargeId: input.reference,
    status: 'PENDING',
    amount: input.amount,
    method: input.method,
    hostedCheckoutUrl: `https://pay.example/${input.reference}`,
  };
}

function redirectProvider(): { adapter: PaymentProviderAdapter; created: string[] } {
  const created: string[] = [];
  const adapter: PaymentProviderAdapter = {
    name: 'redirect',
    displayName: 'redirect',
    capabilities: {
      methods: ['PIX', 'CARD'],
      savedCards: false,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: 'NONE',
    },
    credentialSchema: [],
    verifyCredentials: async () => ({ ok: true }),
    createCharge: async (input) => {
      created.push(input.reference);
      return referenceIsChargeId(input);
    },
    // What `recoverUnfinished` calls. Answers about the id it was ASKED for,
    // which is how attempt 0's charge comes back to an attempt-1 walk.
    getCharge: async (id) => ({
      provider: 'redirect',
      providerChargeId: id,
      status: 'PENDING',
      amount: { amountCents: 459, currency: 'BRL' },
      method: 'PIX',
      hostedCheckoutUrl: `https://pay.example/${id}`,
    }),
    webhook: { verify: async () => true, parse: async () => [] },
    clientConfig: () => ({ provider: 'redirect', tokenization: 'NONE' }),
  };
  return { adapter, created };
}

function world() {
  const { adapter, created } = redirectProvider();
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const attempts = createMemoryAttemptLedger();
  const gateway = createPaymentsGateway({
    providers: defineProviders({ redirect: adapter }),
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts,
  });
  credentials.set(TENANT, 'redirect', STUB_CREDS);
  return { gateway, charges, attempts, created };
}

function chargeInput(reference: string, idempotencyKey: string): ChargeInput {
  return {
    reference,
    amount: { amountCents: 459, currency: 'BRL' },
    method: 'PIX',
    customer: { name: 'Thompson', email: 'buyer@example.com' },
    idempotencyKey,
  };
}

describe('a ledger row naming a charge that belongs to another attempt', () => {
  /**
   * The exact durable state a pre-FUT-669 order carries: attempt 0's charge
   * persisted under the bare order id, and an attempt-1 ledger row that names
   * that same charge because the reference had not yet moved per attempt.
   */
  async function poisonedOrder() {
    const w = await Promise.resolve(world());
    // Attempt 0 — the charge that really is the order's, stored under `:0`.
    await w.gateway.charge(TENANT, chargeInput(ORDER, `${ORDER}:0`));
    // Attempt 1, as the PRE-FIX code ledgered it: same bare reference, so the
    // recorded provider charge id is attempt 0's. Its charge-store write then
    // collided and was refused, which is why no `:1` charge row exists.
    await w.attempts.record({
      merchant: TENANT,
      idempotencyKey: `${ORDER}:1`,
      reference: ORDER,
      provider: 'redirect',
      attemptNo: 1,
      outcome: 'SUCCEEDED',
      providerChargeId: ORDER,
    });
    return w;
  }

  it('does not hand attempt 1 the charge stored under attempt 0', async () => {
    const w = await poisonedOrder();

    // Attempt 1 the way the fixed code raises it: a per-attempt reference.
    const stored = await w.gateway.charge(TENANT, chargeInput(`${ORDER}--1`, `${ORDER}:1`));

    // The whole bug in one assertion. Before the fix this is `${ORDER}:0`,
    // and `chargeIdentityMismatch` turns it into a 409 the buyer can never
    // get past.
    expect(stored.idempotencyKey).toBe(`${ORDER}:1`);
    expect(stored.reference).toBe(`${ORDER}--1`);
  });

  it('gives the buyer a payable link rather than attempt 0s', async () => {
    const w = await poisonedOrder();

    const stored = await w.gateway.charge(TENANT, chargeInput(`${ORDER}--1`, `${ORDER}:1`));

    // A fresh link was minted for THIS attempt — the self-healing path.
    expect(w.created).toContain(`${ORDER}--1`);
    expect(stored.snapshot.hostedCheckoutUrl).toBe(`https://pay.example/${ORDER}--1`);
  });

  it('leaves attempt 0s charge exactly as it was, for reconciliation', async () => {
    const w = await poisonedOrder();

    await w.gateway.charge(TENANT, chargeInput(`${ORDER}--1`, `${ORDER}:1`));

    // Nothing may rewrite or re-key the earlier charge: the buyer may still
    // be holding its link, and it is the row an operator reconciles against.
    const attemptZero = await w.charges.findByIdempotencyKey(TENANT, `${ORDER}:0`);
    expect(attemptZero?.reference).toBe(ORDER);
    expect(attemptZero?.snapshot.providerChargeId).toBe(ORDER);
  });

  it('still resumes a genuinely unfinished charge of its OWN attempt', async () => {
    // The guard must not cost us the case `recoverUnfinished` exists for: the
    // provider created this attempt's charge and our write was lost. Here the
    // ledger names a charge that no row owns, so adopting it is correct — and
    // no second charge may be minted for it.
    const w = world();
    await w.attempts.record({
      merchant: TENANT,
      idempotencyKey: `${ORDER}:0`,
      reference: ORDER,
      provider: 'redirect',
      attemptNo: 1,
      outcome: 'SUCCEEDED',
      providerChargeId: ORDER,
    });

    const stored = await w.gateway.charge(TENANT, chargeInput(ORDER, `${ORDER}:0`));

    expect(stored.snapshot.providerChargeId).toBe(ORDER);
    expect(stored.idempotencyKey).toBe(`${ORDER}:0`);
    expect(w.created).toEqual([]);
  });
});
