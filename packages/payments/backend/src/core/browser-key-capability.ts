import type { ResolvedCredentials } from './types';

/**
 * Minting the PUBLIC browser key a provider tokenizes with, on demand.
 *
 * Declared by the adapters that CAN — a key minted under the merchant's own
 * credentials names the merchant's own account, which is the whole reason a
 * shared platform key cannot serve per-merchant checkouts. Adapters whose key
 * is pasted by the merchant, or that tokenize without one, omit the capability
 * and every caller answers null.
 *
 * Its own module for the same reason as {@link SettlementHints} —
 * `core/provider.ts` is at its size gate, and a capability's rationale is
 * longer than its shape.
 */
export interface BrowserKeyCapability {
  /**
   * The `credentialSchema` key the value lives under, so callers read and
   * cache it by the adapter's own spelling instead of guessing at the union of
   * the spellings they have met (`publicKey ?? publishableKey`).
   *
   * MUST name a NON-SECRET field: the minted value is handed to every
   * shopper's page, and it is cached without invalidating the connection's
   * verification proof — a path no secret may take. See
   * `config/browser-key.ts`.
   */
  readonly field: string;
  /**
   * Best-effort by contract: null on a missing credential, a network failure,
   * or a refusal. A checkout that falls back to a pasted key must never be
   * blocked by this.
   */
  mint(credentials: ResolvedCredentials): Promise<string | null>;
}
