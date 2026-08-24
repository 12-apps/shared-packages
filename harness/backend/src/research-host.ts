/**
 * The half of `@12-apps/product-research`'s HTTP surface a package can never
 * ship: this host's connector registry, its credential encryption, its live
 * probes and its words.
 *
 * Seven things `createApiProductResearch` REQUIRES, and it throws naming each
 * one that is missing — which is itself the contract worth adopting against:
 * a host cannot half-configure this surface and discover the gap at runtime.
 *
 * ## What is genuinely the host's here
 *
 * - **`connectors`** — WHICH connector types this server has mounted, and which
 *   credential fields each reads. An unmounted type is still configurable (the
 *   key is stored, visibly unverified) and starts participating the moment the
 *   connector lands, so `isMounted` is a fact about the deployment rather than
 *   about the package.
 * - **`credentials`** — encryption at rest, and the masked hint a roster may
 *   show. The package never sees a key in the clear on the way back out; the
 *   store scrubs the ciphertext (`research-db.ts`), and this codec is the only
 *   thing that can read it.
 * - **`checks`** — the three live probes, including the SSRF gate over where
 *   the WORKER will fetch on a tenant's behalf. All three refuse with
 *   operator-facing reasons in the host's language, forwarded verbatim.
 * - **`messages` / `diagnostics` / `vocabulary`** — the words. `vocabulary` has
 *   the sharper failure mode of the three: an unstated market vocabulary does
 *   not render another product's language, it silently recognises NOTHING, and
 *   a supplier sheet whose headers a host cannot match yields zero rows and one
 *   problem at line 0.
 *
 * This host passes the package's own named pt-BR packs, which is exactly what
 * the package documents a pt-BR host doing — unlike `shift-host.ts`, where the
 * harness invents a vocabulary because the package deliberately ships none.
 * The distinction is the point: a pack the package SHIPS is config a host
 * chooses; a vocabulary it refuses to ship is config a host must author.
 */
import { createHash, randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { PT_BR_MARKET_VOCABULARY } from '@12-apps/product-research';
import {
  createApiProductResearch,
  type ResearchApi,
  type ResearchCheckResult,
} from '@12-apps/product-research/http';
import {
  PT_BR_RESEARCH_DIAGNOSTICS,
  PT_BR_RESEARCH_MESSAGES,
} from '@12-apps/product-research/pt-BR';

import { applyResearchMigrations, researchStore } from './research-db';
import { honoRouterFor } from './wire-hono';

export const RESEARCH_TENANT_ID = 'research-harness';
export const RESEARCH_TENANT_B_ID = 'research-harness-b';

/** Where the seventeen routes hang. The tenant is a path segment, as in a host. */
export const RESEARCH_MOUNT_PATH = '/api/admin/:tenantSlug';

/** The header this harness resolves the caller from — the rbac host's convention. */
export const RESEARCH_USER_HEADER = 'x-rbac-user';

/**
 * The connector types this server has actually mounted.
 *
 * `SERP` is mounted and `VTEX` is not, deliberately: an unmounted type has to
 * stay configurable, and the `mounted: false` flag is what tells an operator
 * their key is stored and waiting rather than broken.
 */
export const MOUNTED_CONNECTORS = new Set(['SERP', 'AMAZON']);

/** Which credential fields each connector reads; absent means keyless. */
const CREDENTIAL_FIELDS: Record<string, readonly string[]> = {
  SERP: ['apiKey'],
  AMAZON: ['accessKey', 'secretKey'],
  VTEX: ['appKey', 'appToken'],
};

/**
 * The probes, and the switches a suite flips to drive them.
 *
 * Held in one mutable object rather than module-level bindings: the flakiness
 * gate refuses a closed-over binding reassigned from a stub, and a container
 * whose properties move is what the rest of this harness uses.
 */
export const researchProbes = {
  /** `null` = no probe available; a host with no connector cannot verify a key. */
  credentialResult: null as ResearchCheckResult,
  /** `null` = the URL is acceptable; a string is the SSRF gate's own reason. */
  urlViolation: null as string | null,
  reset(): void {
    researchProbes.credentialResult = null;
    researchProbes.urlViolation = null;
  },
};

/**
 * Encryption at rest, and the hint.
 *
 * A real adopter passes whatever it already uses. What matters for the surface
 * is only that the CIPHERTEXT is what lands in the row and the HINT is what a
 * roster may show — so the hint here is deliberately derived from the value's
 * tail, the shape an operator recognises their own key by.
 */
const credentialCodec = {
  encode(credentials: Record<string, string>): string {
    return `enc:${createHash('sha256').update(JSON.stringify(credentials)).digest('base64url')}`;
  },
  hint(credentials: Record<string, string>): string {
    const first = Object.values(credentials)[0] ?? '';
    return first.length <= 4 ? '****' : `****${first.slice(-4)}`;
  },
};

export type HarnessResearch = ReturnType<typeof researchHost>;

export function researchHost(pg: PGlite): ResearchApi & {
  router: ReturnType<typeof honoRouterFor>;
} {
  const api = createApiProductResearch({
    store: researchStore(pg),
    diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
    vocabulary: PT_BR_MARKET_VOCABULARY,
    checks: {
      // A paid connector's key, probed against the provider before it is
      // persisted. `null` means this host cannot probe — which stores the key
      // visibly UNVERIFIED rather than refusing the save.
      integrationCredentials: async () => researchProbes.credentialResult,
      sourceConfig: async () => researchProbes.credentialResult,
      // The SSRF gate over where the WORKER will fetch on a tenant's behalf.
      publicUrlViolation: async () => researchProbes.urlViolation,
    },
    credentials: credentialCodec,
    messages: PT_BR_RESEARCH_MESSAGES,
    connectors: {
      isMounted: (type) => MOUNTED_CONNECTORS.has(type),
      types: () => Object.keys(CREDENTIAL_FIELDS),
      credentialFieldsFor: (type) => CREDENTIAL_FIELDS[type],
    },
    now: () => new Date('2026-08-24T12:00:00.000Z'),
  });

  return {
    ...api,
    // `ResearchRoute` is a structural twin of the wiring contract's `WireRoute`,
    // so the host's ONE bridge serves all seventeen — this adoption needs no
    // research-shaped adapter of its own.
    router: honoRouterFor(
      api.routes.map((route) => ({ route }) as never),
      (c) => {
        const userId = c.req.header(RESEARCH_USER_HEADER);
        if (!userId) return null;
        return { clientId: c.req.param('tenantSlug') ?? RESEARCH_TENANT_ID, userId };
      },
    ),
  };
}

/** The package's own migrations, then a clean slate. */
export async function provisionResearch(pg: PGlite): Promise<HarnessResearch> {
  await applyResearchMigrations(pg);
  await reseedResearch(pg);
  return researchHost(pg);
}

/** Back to an empty catalog, with no source and no stored key. */
export async function reseedResearch(pg: PGlite): Promise<void> {
  researchProbes.reset();
  await pg.exec(`
    DELETE FROM manual_price_entries;
    DELETE FROM supplier_offers;
    DELETE FROM research_runs;
    DELETE FROM research_requests;
    DELETE FROM price_sources;
  `);
}

/** A stable id for a seeded row, so a case can name one without reading it back. */
export function researchId(): string {
  return randomUUID();
}
