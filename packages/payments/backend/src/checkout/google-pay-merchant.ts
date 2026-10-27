/**
 * The platform's ONE Google merchant id (Google Pay & Wallet Console), read
 * from the deployment's environment — the Google twin of Apple Pay's
 * `platformApplePayIdentity`. Google requires it on every PRODUCTION request
 * (`merchantInfo`); a store's own id at its gateway is `gatewayMerchantId`,
 * which the adapter publishes.
 *
 *   GOOGLE_PAY_MERCHANT_ID    the id Google's console issues
 *   GOOGLE_PAY_MERCHANT_NAME  the name the sheet shows (optional)
 *
 * `null` while the id is not set: a PRODUCTION checkout then draws no Google
 * Pay button, since its sheet would refuse the request.
 */
type Env = Readonly<Record<string, string | undefined>>;

export function platformGooglePayMerchant(env: Env): { merchantId: string; merchantName?: string } | null {
  const merchantId = env.GOOGLE_PAY_MERCHANT_ID?.trim();
  if (!merchantId) return null;
  const merchantName = env.GOOGLE_PAY_MERCHANT_NAME?.trim();
  return merchantName ? { merchantId, merchantName } : { merchantId };
}
