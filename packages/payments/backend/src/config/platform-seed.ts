import type { MerchantRef, PaymentEnvironment, ProviderName } from '../core/types';

import type { ProviderConfigStore, StoredProviderConfig } from './types';

/**
 * Seed the PLATFORM merchant's credentials from deployment configuration
 * (FUT-761, ported from the future-pay host).
 *
 * ## Seeding NEVER overwrites a stored credential set (FUT-409)
 *
 * This runs on every boot. The settings panel is a writer too, and the two
 * are incompatible if seeding rewrites rows: an operator who saves a key in
 * the panel on a deployment that still exports the env secrets would have it
 * silently reverted at the next restart — accepted, displayed, and then gone,
 * with collection quietly running on the old key. So the environment
 * BOOTSTRAPS and the panel OWNS: a provider with no stored fields for its
 * environment is seeded; one that already has them is left exactly as it is.
 * To hand a provider back to the environment, clear its fields in the panel —
 * an empty set is seedable again, so the escape hatch is a form submission
 * rather than a DB edit.
 *
 * The failover ORDER is written only when this boot found NO enabled chain:
 * seeding runs every boot, and writing the order unconditionally would revert
 * an operator's choice at the next deploy — a switch that appears to work and
 * then quietly undoes itself is worse than no switch.
 *
 * `stub` is hard-false. Stub mode is SANDBOX-restricted anyway, but the
 * platform merchant is the one account where a deterministic fake would mean
 * recording subscription revenue that never arrived.
 */
export interface PlatformCredentialSeed {
  provider: ProviderName;
  environment: PaymentEnvironment;
  fields: Record<string, string>;
}

/** The store slice the seeder writes through. */
type SeedStore = Pick<ProviderConfigStore, 'get' | 'save' | 'list' | 'setProviderPriorities'>;

/**
 * Whether this provider already holds credentials for the environment the
 * seed describes. An empty map is the shape a row has when it was created for
 * its chain position alone, so "present" is asked about the FIELDS, not the
 * row.
 */
function alreadyStored(
  existing: StoredProviderConfig | null,
  environment: PaymentEnvironment,
): boolean {
  return Object.keys(existing?.environments?.[environment] ?? {}).length > 0;
}

/**
 * The verification state a re-seed inherits from the row already there.
 *
 * Re-seeding must not claim a rotated secret is still verified, so `status`
 * carries over only when the environment is unchanged — a SANDBOX→PRODUCTION
 * switch always re-verifies. `chargeVerifiedAt` is carried, never invented:
 * the field means "a real charge succeeded", and stamping one that never
 * happened is the exact lie the column exists to prevent.
 * `pendingVerification` is always nulled — the platform's own connection is
 * activated by nobody's settings screen, so it can have no activation charge
 * outstanding, and carrying one across a re-seed would be inventing state.
 */
function inheritedVerification(
  existing: StoredProviderConfig | null,
  environment: PaymentEnvironment,
): Pick<
  StoredProviderConfig,
  'status' | 'lastVerifiedAt' | 'chargeVerifiedAt' | 'pendingVerification'
> {
  const sameEnvironment = existing !== null && existing.environment === environment;
  return {
    status: sameEnvironment ? existing.status : 'UNVERIFIED',
    lastVerifiedAt: existing?.lastVerifiedAt ?? null,
    chargeVerifiedAt: existing?.chargeVerifiedAt ?? null,
    pendingVerification: null,
  };
}

/** Write ONE seed, preserving what a re-seed must not reset. Returns whether it wrote. */
async function seedOne(
  store: SeedStore,
  merchant: MerchantRef,
  seed: PlatformCredentialSeed,
): Promise<boolean> {
  const existing = await store.get(merchant, seed.provider);
  if (alreadyStored(existing, seed.environment)) return false;
  await store.save(merchant, {
    provider: seed.provider,
    enabled: true,
    // Provisional: the authoritative order is set once, below. A row saved
    // here can never be the thing that decides who collects.
    priority: existing?.priority ?? 0,
    environment: seed.environment,
    ...inheritedVerification(existing, seed.environment),
    expiresAt: null,
    stub: false,
    environments: {
      ...(existing?.environments ?? { SANDBOX: {}, PRODUCTION: {} }),
      [seed.environment]: seed.fields,
    },
  });
  return true;
}

/**
 * Idempotent bootstrap — safe on every boot or deploy. A deployment with no
 * seeds is a no-op, not an error: that is the state every environment starts
 * in. Reading the seeds out of the deployment's env vars stays HOST wiring;
 * this owns everything after that.
 *
 * `order` decides the initial chain when none exists yet (identity by
 * default) — hosts with a house preference pass their own.
 */
export async function ensurePlatformCredentials(
  store: SeedStore,
  merchant: MerchantRef,
  seeds: readonly PlatformCredentialSeed[],
  order: (providers: ProviderName[]) => ProviderName[] = (providers) => providers,
): Promise<ProviderName[]> {
  if (seeds.length === 0) return [];

  // Read the chain BEFORE writing any row, so "was an order already chosen?"
  // is answered about the state this boot found rather than the one it just
  // created.
  const hadChain = (await store.list(merchant)).some((row) => row.enabled);

  for (const seed of seeds) {
    await seedOne(store, merchant, seed);
  }

  const providers = seeds.map((seed) => seed.provider);
  if (!hadChain) {
    await store.setProviderPriorities(merchant, order(providers));
  }
  return providers;
}
