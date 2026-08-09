import { describe, expect, it } from 'vitest';

import { webhookFieldOf } from '../core/credential-roles';
import { infinitePayProvider } from '../providers/infinitepay';
import { pagbankProvider } from '../providers/pagbank';
import { stripeProvider } from '../providers/stripe';

/**
 * Adapter-declared field roles (FUT-761). The future-pay host kept
 * `pagbank → webhookToken` / `stripe → webhookSecret` as a hand-written
 * table, and its own test re-derived every entry from the adapter's
 * `credentialSchema` — the tell that the answer belongs in the package.
 * Asserted here against the REAL adapters so the role can never drift from
 * the schema it annotates.
 */

describe('webhookFieldOf', () => {
  it('answers each adapter from its own schema', () => {
    expect(webhookFieldOf(pagbankProvider())).toBe('webhookToken');
    expect(webhookFieldOf(stripeProvider())).toBe('webhookSecret');
  });

  it('answers null for a provider that declares no inbound-delivery secret', () => {
    expect(webhookFieldOf(infinitePayProvider())).toBeNull();
  });
});
