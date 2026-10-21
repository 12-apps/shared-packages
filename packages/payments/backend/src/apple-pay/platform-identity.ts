import type { ApplePayIdentityPort, ApplePayMerchantIdentity } from './types';

/**
 * ONE Apple Pay Merchant ID for the whole platform, read from the deployment's
 * environment (FUT-3757). A marketplace's sellers have no Apple Developer
 * account of their own, so a per-store identity has nothing to come from; the
 * sheet still names the store, through `storeName`.
 *
 * Read at call time, so a rotated certificate is picked up without a build:
 *
 *   APPLE_PAY_MERCHANT_ID    Apple's Merchant ID, e.g. `merchant.com.example`
 *   APPLE_PAY_MERCHANT_CERT  PEM merchant identity certificate
 *   APPLE_PAY_MERCHANT_KEY   PEM private key of that certificate
 *   APPLE_PAY_DOMAINS        comma-separated domains verified for the Merchant ID
 *
 * Any of the first three missing answers `null` — APPLE_PAY stays out of the
 * buyer config and a validation answers `NOT_CONFIGURED`. So does a merchant
 * that is not a store, or a store `storeName` does not know.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** Apple caps `displayName` at 64 UTF-8 characters. */
const DISPLAY_NAME_MAX = 64;

/** The platform identity minus the store's name, or null while it is not configured. */
export function platformApplePayIdentity(env: Env): Omit<ApplePayMerchantIdentity, 'displayName'> | null {
  const merchantIdentifier = env.APPLE_PAY_MERCHANT_ID?.trim();
  const certificate = env.APPLE_PAY_MERCHANT_CERT?.trim();
  const privateKey = env.APPLE_PAY_MERCHANT_KEY?.trim();
  if (!merchantIdentifier || !certificate || !privateKey) return null;
  const domains = (env.APPLE_PAY_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean);
  return { merchantIdentifier, certificate, privateKey, ...(domains.length > 0 ? { domains } : {}) };
}

export function platformApplePayIdentities(options: {
  env: Env;
  /** The store's name on the sheet, or null for an unknown store. */
  storeName(tenantId: string): Promise<string | null>;
}): ApplePayIdentityPort {
  return {
    merchantIdentity: async (merchant) => {
      const platform = platformApplePayIdentity(options.env);
      if (!platform || merchant.kind !== 'TENANT') return null;
      const name = await options.storeName(merchant.id);
      if (!name) return null;
      return { ...platform, displayName: [...name].slice(0, DISPLAY_NAME_MAX).join('') };
    },
  };
}
