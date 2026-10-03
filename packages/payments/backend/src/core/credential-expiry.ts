/**
 * When a pasted credential set stops working on its own — a certificate's
 * `validTo` — answered from the stored fields, with no network call.
 *
 * Declared by the adapters whose credentials EXPIRE without anyone revoking
 * them: Itaú's production mTLS certificate lives 365 days and the bank leaves
 * renewal to the client, so on the day it lapses the store's PIX stops. The
 * masked settings view carries the answer (`credentialExpiresAt`) so a screen
 * can warn the owner inside the renewal window instead.
 *
 * Deliberately NOT `StoredProviderConfig.expiresAt`: that column drives the
 * OAuth renewal sweep (`jobs/sweeps.ts`, through `listExpiring`), which would
 * try to refresh a connection that has nothing to refresh. This is derived on
 * every read and never stored.
 *
 * Its own module for the reason `BrowserKeyCapability` has one —
 * `core/provider.ts` is at its size gate.
 */
export type CredentialExpiry = (fields: Readonly<Record<string, string>>) => string | null;
