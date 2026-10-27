/** A chain entry's Google Pay parameters (FUT-471); `merchantInfo` is the platform's Google id, which PRODUCTION needs (FUT-4109). */
export interface CheckoutGooglePayParams {
  gateway: string;
  gatewayMerchantId: string | null;
  environment?: "TEST" | "PRODUCTION";
  merchantInfo?: { merchantId: string; merchantName?: string };
}

/** The Google Pay half of a chain entry (`CheckoutChainLink`). */
export interface GooglePayDeclaration {
  /**
   * Google Pay's `PAYMENT_GATEWAY` tokenizationSpecification parameters for
   * THIS entry (FUT-471), or absent/`null` when it cannot run Google Pay.
   * `gatewayMerchantId: null` means the connection carries no merchant id yet
   * — the button must not render, because a token minted against a missing id
   * charges nobody.
   */
  googlePay?: CheckoutGooglePayParams | null;
}
