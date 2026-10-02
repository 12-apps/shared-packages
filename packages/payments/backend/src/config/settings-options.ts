import type { MerchantWebhookUrlResolver } from '../core/webhook-url';

/** Construction-time options — NOT reachable from any request body. */
export interface SettingsServiceOptions {
  /**
   * Allow SANDBOX configurations to run provider adapters in stub mode
   * (deterministic fakes, no network). Stub card charges report `PAID`
   * without money moving, so this is a deployment decision for local dev
   * and demo tenants: default OFF, and refused for PRODUCTION even when on.
   *
   * Take it from `resolveStubMode(process.env)` rather than inferring it from
   * whatever else happens to be in the environment — see `core/stub-mode.ts`.
   */
  allowStubMode?: boolean;
  /**
   * Where this merchant's webhooks land, for the credential PROBE — the same
   * resolver the charge path takes through `withMerchantWebhookUrl`. Given it,
   * "Testar conexão" hands the adapter the URL as `notificationUrl`, so a
   * provider that registers its webhook through an API (Itaú, BACEN
   * `PUT /webhook/{chave}`) can do so the moment the credentials are proven.
   * Resolved per probe and never stored, for the reason the charge path
   * resolves it per read. Omitted, probes run on the stored fields alone.
   */
  webhookUrl?: MerchantWebhookUrlResolver;
}

/**
 * The probe's webhook URL, or null. A resolver that throws (a slug lookup that
 * failed) must not take "Testar conexão" down with it — for every provider,
 * most of which never read the URL — so it reads as "no URL", which the
 * adapters already report as not registered.
 */
export async function resolveWebhookUrl(
  options: SettingsServiceOptions,
  merchant: Parameters<MerchantWebhookUrlResolver>[0],
  provider: Parameters<MerchantWebhookUrlResolver>[1],
): Promise<string | null> {
  try {
    return (await options.webhookUrl?.(merchant, provider)) ?? null;
  } catch {
    return null;
  }
}
