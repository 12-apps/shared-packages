/**
 * The debit card's wire and config shapes (FUT-3754) — their own module for
 * the size gate on `types.ts`, which extends them.
 */

/** A chain entry's debit claim: absent (an older host) means no debit, as `wallets`. */
export interface DebitDeclaration {
  /** THIS entry charges a card as DEBIT, 3-D Secure authenticated. */
  debit?: boolean;
}

/** What makes a card charge a debit one. Absent means credit, as every charge before it. */
export interface DebitChargeFields {
  funding?: "DEBIT";
  /** The 3-D Secure authentication the buyer completed for this charge. */
  authenticationId?: string;
}

/** `POST /3ds-session`'s answer: what the provider's 3-D Secure SDK runs on. */
export interface ThreeDSecureSessionView {
  provider: string;
  session: string;
  expiresAt: number;
  environment: "SANDBOX" | "PRODUCTION";
}
