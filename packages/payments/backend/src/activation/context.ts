import type { ProviderConfigStore } from '../config/types';
import type { SettingsService } from '../config/service';
import type { ProviderRegistry } from '../core/registry';
import type { MerchantRef, ResolvedCredentials } from '../core/types';
import type { MerchantWebhookUrlResolver } from '../core/webhook-url';

/**
 * What the activation/verification flow needs from a host (FUT-558).
 *
 * The flow itself — probe amounts, the card and redirect verification
 * charges, the pending-verification lifecycle — lives in this package; a host
 * contributes only what the package must never own: its registry, its stores,
 * and how ITS deployment turns a merchant into a URL. Same split as the
 * gateway's `failoverPolicyFor` / `onWebhookEvent` hooks.
 */
export interface ActivationContext {
  /** The adapters this deployment routes to. */
  providers: ProviderRegistry;
  /**
   * Raw connection rows. Read WITHOUT the enabled gate on purpose:
   * verification runs BEFORE activation, on a provider that is by definition
   * still off — see {@link credentialsForVerification}.
   */
  config: Pick<ProviderConfigStore, 'get'>;
  /** The pending activation charge's durable home. */
  settings: Pick<SettingsService, 'getPendingVerification' | 'setPendingVerification'>;
  /**
   * Where THIS merchant's webhooks land — stamped onto the verification
   * credentials so the proof charge announces the same destination a
   * shopper's charge does. Optional: a host with no public origin simply
   * verifies without one.
   */
  webhookUrl?: MerchantWebhookUrlResolver;
  /**
   * Where a hosted-checkout provider must send the OWNER back after paying
   * the activation charge — the settings screen they started from, never the
   * storefront checkout. InfinitePay hangs `transaction_nsu` and `slug` off
   * this URL, and `payment_check` refuses to confirm without them.
   */
  returnUrl?: MerchantWebhookUrlResolver;
  /**
   * Whether this deployment may run adapters in stub mode — from
   * `resolveStubMode(process.env)`, never inferred. Defaults to OFF.
   *
   * A stubbed verification charge answers PAID without asking an acquirer
   * anything, and a pass is what stamps `chargeVerifiedAt` and lets the
   * provider be switched on. On a deployment that takes real money, a
   * left-over `stub=true` row would otherwise activate a connection nothing
   * was ever charged through — see `credentialsForVerification`.
   */
  allowStubMode?: boolean;
  /**
   * Mint a card-encryption public key with the merchant's OWN credentials
   * when none is stored — the PagBank lazy backfill (an OAuth-connected store
   * never pastes a key). Host-provided because the fetch and the caching are
   * both host decisions; providers with nothing to mint simply answer null.
   */
  mintCardPublicKey?: (
    merchant: MerchantRef,
    provider: string,
    credentials: ResolvedCredentials,
  ) => Promise<string | null>;
}
