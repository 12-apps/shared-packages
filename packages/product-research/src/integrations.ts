import type { SourceRecord } from './types';

/**
 * Paid-connector integrations (FUT-434). SERP, AMAZON and MERCADO_LIVRE are
 * not "create a source by name": each is at most ONE integration per tenant,
 * running on the tenant's own API credential — usage is billed to them. The
 * host stores that credential ENCRYPTED in the source row's config (under
 * {@link ENCRYPTED_CREDENTIALS_KEY}) and injects the decrypted record at run
 * time under {@link CREDENTIALS_KEY}, so connectors only ever see plaintext
 * in memory. The one-row-per-(tenant, type) invariant is enforced by a
 * partial unique index in this package's migrations.
 *
 * Decision note (per connector): all three launch with a TENANT key —
 * SearchApi.io bills per search for SERP and Amazon, and Mercado Livre rate-
 * limits per application, so per-tenant credentials keep cost and quota with
 * the tenant that spends them. Should a provider turn out not to charge per
 * tenant, a platform-level (super-admin) token is a host concern: mount a
 * connector whose credentials come from the host's own secret store instead
 * of the source config — no change to this seam is needed.
 */

export const INTEGRATION_SOURCE_TYPES = ['SERP', 'AMAZON', 'MERCADO_LIVRE'] as const;
export type IntegrationSourceType = (typeof INTEGRATION_SOURCE_TYPES)[number];

export const isIntegrationSourceType = (type: string): type is IntegrationSourceType =>
  (INTEGRATION_SOURCE_TYPES as readonly string[]).includes(type);

/** Types created by name in the sources dialog — multi-instance per tenant. */
export const NAMED_SOURCE_TYPES = ['VTEX', 'MANUAL'] as const;

/** Config key holding the encrypted credential blob at rest (host-encoded). */
export const ENCRYPTED_CREDENTIALS_KEY = 'credentialsEncrypted';

/** Config key under which the host injects the DECRYPTED record at run time. */
export const CREDENTIALS_KEY = 'credentials';

/**
 * The decrypted credential record of an integration source, `{}` when the
 * host injected none (missing key, or a blob that no longer decrypts). A
 * connector treats an empty record as a definitive "no credential" failure —
 * visible in the run's source stats, never a crash.
 */
export function credentialsOf(source: Pick<SourceRecord, 'config'>): Record<string, string> {
  const raw = source.config[CREDENTIALS_KEY];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return Object.fromEntries(entries);
}
