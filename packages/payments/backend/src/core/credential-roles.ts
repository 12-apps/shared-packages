import type { PaymentProviderAdapter } from './provider';
import { credentialSchemaOf } from './credential-schema';

/**
 * Readers of adapter-declared field ROLES (FUT-761, ported from the first
 * adopting host).
 *
 * The host kept a hand-written provider→field table
 * (`pagbank → webhookToken`, `stripe → webhookSecret`) to know where each
 * provider's inbound-delivery secret lives, and its own test had to re-derive
 * every entry from the adapter's `credentialSchema` "which is the only thing
 * that makes this table safe to keep by hand". A test that re-derives the
 * answer from the package means the answer belongs in the package — so the
 * schema now carries the role and this is the one reader.
 */

/**
 * The credential field whose value authenticates INBOUND deliveries for this
 * adapter, or null for a provider that declares none (unsigned webhooks, or
 * verification by live call-back).
 */
export function webhookFieldOf(adapter: PaymentProviderAdapter): string | null {
  const spec = credentialSchemaOf(adapter).find((field) => field.role === 'webhookSecret');
  return spec?.key ?? null;
}
