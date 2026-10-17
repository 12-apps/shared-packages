import type { MerchantRef } from '../core/types';

/**
 * Apple Pay merchant validation (FUT-3686) — the vocabulary, TYPES ONLY.
 *
 * Its own module so the root entry (and `@12-apps/payments-frontend`, which
 * may import only types from this package) can name these shapes without
 * reaching `./validate.ts`, which goes over `node:https`.
 */

/**
 * A merchant identity as Apple issues it: the Merchant ID and the merchant
 * identity certificate + private key that authenticate the validation call at
 * the TLS layer. Secret material — never logged, never answered to a browser.
 */
export interface ApplePayMerchantIdentity {
  /** Apple's Merchant ID, e.g. `merchant.com.example.store`. */
  merchantIdentifier: string;
  /** The store's name on the sheet: 64 UTF-8 characters or fewer, never localized. */
  displayName: string;
  /** PEM merchant identity certificate — a leaf alone, or a leaf followed by its chain. */
  certificate: string;
  /** PEM private key matching the leaf in `certificate`. */
  privateKey: string;
  /**
   * The domains registered (and verified) for this Merchant ID. Optional: when
   * given, a validation for any other domain is refused before Apple is asked.
   */
  domains?: readonly string[];
}

/**
 * Where the merchant identity comes from — the CREDENTIALS PORT.
 *
 * Whether the identity is the platform's (one Merchant ID for every store) or
 * each seller's is FUT-773's decision, and that is exactly why it is a port:
 * the merchant this request is for is handed over, and the host answers from
 * whichever store holds the certificate. `null` means "no merchant identity
 * here", which both gates Apple Pay out of the buyer config and answers a
 * validation request with the typed not-configured result.
 */
export interface ApplePayIdentityPort {
  merchantIdentity(merchant: MerchantRef): Promise<ApplePayMerchantIdentity | null>;
}

/**
 * The merchant session Apple answers — OPAQUE. It is handed to the page
 * unchanged, which passes it to `ApplePaySession.completeMerchantValidation`;
 * nothing here reads a field of it. It expires after five minutes.
 */
export type ApplePayMerchantSession = Record<string, unknown>;

/** What `validateApplePayMerchant` resolves to when it did not throw. */
export type ApplePayValidationResult =
  | { status: 'VALIDATED'; session: ApplePayMerchantSession }
  /** No merchant identity for this merchant (or the platform) — not an error, a store state. */
  | { status: 'NOT_CONFIGURED' };

/**
 * Why a validation failed, as a stable machine code (the wire `code` too):
 *
 * - `INVALID_VALIDATION_URL` — not an `https` URL on one of Apple's gateway hosts
 * - `INVALID_DOMAIN`         — no usable domain, or one the identity is not registered for
 * - `IDENTITY_UNAVAILABLE`   — the identity port itself failed (threw or rejected)
 * - `IDENTITY_UNUSABLE`      — certificate/key unreadable, mismatched, expired or not yet valid
 * - `TIMEOUT`                — Apple did not answer in time
 * - `UNREACHABLE`            — the call failed before any answer (DNS, TLS, reset)
 * - `UPSTREAM_REFUSED`       — Apple answered non-2xx
 * - `INVALID_RESPONSE`       — Apple answered 2xx with something that is not a session object
 */
export type ApplePayValidationFailureCode =
  | 'INVALID_VALIDATION_URL'
  | 'INVALID_DOMAIN'
  | 'IDENTITY_UNAVAILABLE'
  | 'IDENTITY_UNUSABLE'
  | 'TIMEOUT'
  | 'UNREACHABLE'
  | 'UPSTREAM_REFUSED'
  | 'INVALID_RESPONSE';

/** The route's refusal codes: the failures above, plus the not-configured state and a bad body. */
export type ApplePayValidationRefusalCode =
  | ApplePayValidationFailureCode
  | 'APPLE_PAY_NOT_CONFIGURED'
  | 'BAD_REQUEST';
