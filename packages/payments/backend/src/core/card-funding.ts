import type { PaymentEnvironment, ResolvedCredentials } from './types';

/**
 * Debit cards (FUT-3754) — their own module for the same reason as
 * `wallet-types.ts` (the size gate on `core/types.ts`), and re-exported from
 * there so every adapter and host keeps importing from `core/types`.
 */

/**
 * Which side of the card a charge draws on. Absent on a `CardDetails` means
 * `CREDIT`: every card charge before debit existed was one, and reading the
 * absence any other way would re-label all of them.
 */
export type CardFunding = 'CREDIT' | 'DEBIT';

/**
 * A short-lived session the browser hands the provider's 3-D Secure SDK, so the
 * cardholder can authenticate a debit charge with their bank.
 *
 * Debit is never charged unauthenticated here: PagBank's Orders API requires
 * `authentication_method` on every `DEBIT_CARD` charge, and the only way to
 * obtain its id is the SDK running in the buyer's own browser. The session is
 * minted SERVER-side because it is minted with the merchant's secret token.
 */
export interface ThreeDSecureSession {
  /** Opaque; what the browser SDK's setup takes. */
  session: string;
  /** Epoch milliseconds. PagBank's sessions last 30 minutes. */
  expiresAt: number;
  /** Which of the provider's environments the SDK must be pointed at. */
  environment: PaymentEnvironment;
}

/**
 * An adapter's debit support. Declaring it is a claim that `createCharge`
 * understands `card.funding === 'DEBIT'` together with `card.authenticationId`;
 * the walk skips a debit charge on any provider that never made the claim,
 * because charging it as credit would take money the buyer did not agree to.
 */
export interface DebitCapability {
  /** Mint the browser's 3-D Secure session with the merchant's credentials. */
  createSession(credentials: ResolvedCredentials): Promise<ThreeDSecureSession>;
}
