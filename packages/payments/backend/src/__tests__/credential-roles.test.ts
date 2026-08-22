import { describe, expect, it } from 'vitest';

import { webhookFieldOf } from '../core/credential-roles';
import { infinitePayProvider } from '../providers/infinitepay';
import { pagbankProvider } from '../providers/pagbank';
import { stripeProvider } from '../providers/stripe';
import { PT_BR_INFINITEPAY_COPY, PT_BR_PAGBANK_COPY, PT_BR_STRIPE_COPY } from '../providers/pt-BR';

/**
 * Adapter-declared field roles (FUT-761). The origin host kept
 * `pagbank → webhookToken` / `stripe → webhookSecret` as a hand-written
 * table, and its own test re-derived every entry from the adapter's
 * `credentialSchema` — the tell that the answer belongs in the package.
 * Asserted here against the REAL adapters so the role can never drift from
 * the schema it annotates.
 */

describe('webhookFieldOf', () => {
  it('answers each adapter from its own schema', () => {
    expect(webhookFieldOf(pagbankProvider(PT_BR_PAGBANK_COPY))).toBe('webhookToken');
    expect(webhookFieldOf(stripeProvider(PT_BR_STRIPE_COPY))).toBe('webhookSecret');
  });

  it('answers null for a provider that declares no inbound-delivery secret', () => {
    expect(webhookFieldOf(infinitePayProvider(PT_BR_INFINITEPAY_COPY))).toBeNull();
  });
});
