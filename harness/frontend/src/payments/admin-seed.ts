/**
 * SEEDING the merchant admin store: `AdminStage` → stored row.
 *
 * Written through `store.save`, never through `settings.saveCredentials` — the
 * same reason future-pay's state route gives: the service's invalidation
 * cascade (clear status, drop the proof, `enabled: false`) would destroy the
 * exact state a case is trying to establish.
 *
 * `enabled` and `priority` are never written by hand. Every row lands with
 * `enabled: false`, then ONE `store.setProviderPriorities(merchant, chain)`
 * call ranks the chain — the store's own atomic API, which touches nothing
 * else, so a `connected`-stage provider listed in `chain` comes out enabled
 * and unproven: exactly the grandfathered state the FUT-463 migration left
 * every pre-existing store in.
 */
import type {
  CredentialFieldSpec,
  MerchantRef,
  OAuthConnectService,
  ProviderConfigStatus,
  ProviderConfigStore,
  ProviderRegistry,
  StoredProviderConfig,
} from '@12-apps/payments-backend';

import type { AdminStage, AdminStoreSpec } from './admin-store';

/** A frozen clock, so nothing seeded depends on the run date. */
const T0 = new Date('2026-01-15T12:00:00Z');
const DAY_MS = 864e5;

/**
 * The one deterministic source of field values: the schema itself. There is
 * deliberately no `credentials` knob on `AdminStoreSpec` — a schema change
 * shows up as a re-seeded fixture rather than as a stale literal.
 */
function credentialFieldsFor(schema: readonly CredentialFieldSpec[]): Record<string, string> {
  return Object.fromEntries(schema.map((field) => [field.key, field.placeholder ?? `chave-${field.key}`]));
}

/**
 * What a completed authorization leaves in the blob: the token pair plus the
 * reserved identity keys (`accountId`, `accountLabel`, `scope`, `connectedAt`)
 * that `connectedAccountFrom` reads back for the settings page.
 */
function oauthBlobFor(name: string): Record<string, string> {
  return {
    accessToken: 'at_seed',
    refreshToken: 'rt_seed',
    accountId: 'ACC-9921',
    accountLabel: `Loja Harness (${name})`,
    scope: 'payments.read payments.create',
    connectedAt: T0.toISOString(),
  };
}

interface StageShape {
  /** SANDBOX holds the OAuth token blob instead of schema fields. */
  oauth?: boolean;
  /** Pre-refresh status; `reconnect-required` is REWRITTEN by the service. */
  status: ProviderConfigStatus;
  verifiedAt: Date | null;
  provenAt: Date | null;
  /** Relative to now — `expiryProximity` compares against the real clock. */
  expiresInDays?: number;
}

const STAGE_SHAPES: Record<Exclude<AdminStage, 'fresh'>, StageShape> = {
  saved: { status: 'UNVERIFIED', verifiedAt: null, provenAt: null },
  connected: { status: 'VERIFIED', verifiedAt: T0, provenAt: null },
  proven: { status: 'VERIFIED', verifiedAt: T0, provenAt: T0 },
  'oauth-connected': { oauth: true, status: 'VERIFIED', verifiedAt: T0, provenAt: T0, expiresInDays: 90 },
  expiring: { oauth: true, status: 'VERIFIED', verifiedAt: T0, provenAt: T0, expiresInDays: 2 },
  'reconnect-required': { oauth: true, status: 'VERIFIED', verifiedAt: T0, provenAt: T0, expiresInDays: -1 },
};

function rowFor(
  name: string,
  stage: Exclude<AdminStage, 'fresh'>,
  registry: ProviderRegistry,
): StoredProviderConfig {
  const shape = STAGE_SHAPES[stage];
  return {
    provider: name,
    enabled: false, // ranked by `setProviderPriorities`, never by hand
    priority: 0,
    environment: 'SANDBOX',
    status: shape.status,
    lastVerifiedAt: shape.verifiedAt,
    chargeVerifiedAt: shape.provenAt,
    pendingVerification: null,
    expiresAt:
      shape.expiresInDays === undefined ? null : new Date(Date.now() + shape.expiresInDays * DAY_MS),
    // `stubResolvedFor` needs all three of the deployment flag, the stored
    // flag and SANDBOX — the deployment flag is `allowStubMode: true` above.
    stub: true,
    environments: {
      SANDBOX: shape.oauth
        ? oauthBlobFor(name)
        : credentialFieldsFor(registry.get(name).credentialSchema),
      PRODUCTION: {},
    },
  };
}

/**
 * Seed one case's world. Async because the `reconnect-required` stage is
 * produced BY THE PUBLISHED SERVICE, not by writing the row: after the
 * priorities pass, `oauth.refresh` runs against an adapter declared with
 * `refreshFails: true`, and `refreshConnect` catches the throw, stamps
 * `RECONNECT_REQUIRED` and saves — leaving `enabled`, `expiresAt` and the
 * token blob untouched, which is the FUT-683 shape.
 *
 * The refresh pass runs LAST so the row it reads already has its final rank.
 * A `reconnect-required` provider must NOT be in `spec.unregisteredApps`:
 * `appCreds` is evaluated inside the same try, so an unregistered app would
 * produce the same status for the wrong reason.
 */
export async function seedStages(
  store: ProviderConfigStore,
  oauth: OAuthConnectService,
  registry: ProviderRegistry,
  merchant: MerchantRef,
  spec: AdminStoreSpec,
): Promise<void> {
  const stages = Object.entries(spec.stages ?? {});
  for (const [name, stage] of stages) {
    if (stage === 'fresh') continue; // no row written at all
    await store.save(merchant, rowFor(name, stage, registry));
  }
  // ONE atomic ranking pass: `enabled = rank >= 0`, dense collision-free
  // priorities, and nothing else touched — no gate consulted, which is what
  // lets a `connected`-stage row in `chain` come out enabled-but-unproven.
  await store.setProviderPriorities(merchant, spec.chain ?? []);
  if (spec.failoverPolicy) await store.setFailoverPolicy(merchant, spec.failoverPolicy);
  for (const [name, stage] of stages) {
    if (stage !== 'reconnect-required') continue;
    await oauth.refresh(merchant, name);
  }
}
