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
import { normalizeText, PT_BR_MARKET_VOCABULARY } from '@12-apps/product-research';
import type { ResearchCheckResult } from '@12-apps/product-research/http';
import { productResearchManifest } from '@12-apps/product-research/manifest';
import { productResearchServerManifest } from '@12-apps/product-research/manifest/server';
import type { BoundJob, MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';
import {
  PT_BR_RESEARCH_DIAGNOSTICS,
  PT_BR_RESEARCH_MESSAGES,
} from '@12-apps/product-research/pt-BR';

import { Hono } from 'hono';

import { applyResearchMigrations, researchStore } from './research-db';
import { settleResearchRun } from './research-worker';
import { settleResearchRun } from './research-worker';
import { Params, type SqlRunner } from './rbac-db-shared';
import { LATEST_RUN_JOIN, REQUEST_VIEW_COLUMNS, toRequestView } from './research-views';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

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
  /**
   * Whether this host's queue accepted the run.
   *
   * `'inline'` settles it there and then — what makes the run screen's poll
   * resolve here the way it resolves on a deploy. `'unavailable'` is the OTHER
   * branch the package documents and a healthy host never reaches: the request
   * is persisted, the answer is still 202, `enqueued` is false, and no run
   * exists until a reconciliation sweep re-enqueues it. Neither is a failure,
   * which is the whole point of the flag.
   */
  queue: 'inline' as 'inline' | 'unavailable',
  reset(): void {
    researchProbes.credentialResult = null;
    researchProbes.urlViolation = null;
    researchProbes.queue = 'inline';
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

export interface ResearchWiring {
  router: ReturnType<typeof honoRouterFor>;
  /** The consumer's account of what was bound, declined or left over. */
  report: WiringReport;
  routes: readonly MountedRoute[];
  /** The package's OWN job blueprints, bound to this host's deps. */
  jobs: readonly BoundJob[];
}

/**
 * The surface, adopted through `@12-apps/wiring/consumer`.
 *
 * The first version of this adoption called `createApiProductResearch`
 * directly, and that is the failure the contract exists to stop. This package
 * declares FIVE capabilities and only one of them is `http`:
 *
 * - **`jobs`** — the run blueprint, with a retry policy the package states and
 *   argues for ("three attempts, exponentially spaced from five seconds, cheap
 *   because the pipeline is idempotent per runId"). A hand-mount does not
 *   decline it; it simply does not see it, and this harness answered it with a
 *   host-written worker whose numbers were nobody's. Bound below, so the
 *   policy the package reasons about is the policy that runs.
 * - **`permissions`**, **`mcp`** and **`db`** — collected rather than bound.
 *   Collected still means COUNTED: they appear in the report, so a host can be
 *   asked what it did with them.
 *
 * And the reason it matters beyond tidiness: the day this package declares a
 * sixth, `assemble()` throws naming it instead of the harness quietly not
 * running it. That is the whole difference between a contract and a
 * convention.
 */
/**
 * The seven things `createApiProductResearch` requires, as one value.
 *
 * Its own function rather than an inline literal so `researchHost` stays under
 * the size gate — and because this is the half a reader actually compares
 * against the package's own list of required config, while everything around
 * it is contract mechanics.
 */
function researchApiConfig(
  pg: PGlite,
  enqueueRun: (clientId: string, requestId: string) => Promise<{ enqueued: boolean }>,
) {
  return {
    store: researchStore(pg, enqueueRun),
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
      isMounted: (type: string) => MOUNTED_CONNECTORS.has(type),
      types: () => Object.keys(CREDENTIAL_FIELDS),
      credentialFieldsFor: (type: string) => CREDENTIAL_FIELDS[type],
    },
    now: () => new Date('2026-08-24T12:00:00.000Z'),
  };
}

export function researchHost(pg: PGlite): ResearchWiring {
  // Late-bound on purpose, and it is the only way round a real cycle: the
  // store needs an `enqueueRun` to be built, the http binding needs the store,
  // and the BOUND job only exists after `assemble()`. So the store is handed a
  // stable function that consults this holder, which is filled in below.
  const enqueue = inlineEnqueue();

  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    ports: { loggerFor: harnessLoggerFor },
  });

  host.adoptServer({
    manifest: productResearchManifest,
    server: productResearchServerManifest,
    bindings: {
      http: {
        mountPath: RESEARCH_MOUNT_PATH,
        config: researchApiConfig(pg, enqueue.run),
      },
      // ONE dep, exactly as the blueprint documents: the host closes its
      // request read over `runResearch`, and `null` means the request no longer
      // exists — a completed job, never a retryable failure.
      //
      // The offers and stats come back EMPTY, and that is not a shortcut: the
      // blueprint's handler discards the return value entirely
      // (`await deps.runResearch(payload)`), and the run's real rows are the
      // ones `settleResearchRun` wrote to the database — which is where the
      // endpoints read them from and where the suite asserts on them.
      jobs: {
        deps: {
          runResearch: async ({ clientId, requestId }: { clientId: string; requestId: string }) => {
            const runId = await settleResearchRun(pg, requestId, clientId);
            return runId === null
              ? null
              : { runId, status: 'COMPLETED' as const, offers: [], sourceStats: [] };
          },
        },
      },
    },
  });

  const wired = host.assemble();
  // What closes the cycle: from here on, an enqueue runs the PACKAGE's own
  // handler with the package's own payload shape, rather than a host function
  // that merely resembles it.
  enqueue.bind(wired.jobs);

  return {
    report: wired.report,
    routes: wired.routes,
    jobs: wired.jobs,
    // `ResearchRoute` is a structural twin of the wiring contract's `WireRoute`,
    // so the host's ONE bridge serves all sixteen — this adoption needs no
    // research-shaped adapter of its own.
    router: honoRouterFor(wired.routes, (c) => {
      const userId = c.req.header(RESEARCH_USER_HEADER);
      if (!userId) return null;
      return { clientId: c.req.param('tenantSlug') ?? RESEARCH_TENANT_ID, userId };
    }),
  };
}

/**
 * This host's queue: none, so the bound job's handler runs INLINE.
 *
 * The same choice the harness makes for realtime, and the honest one for a
 * server with no worker process. What matters is that it runs the job the
 * consumer BOUND — the package's own `handle`, over the package's own
 * `ResearchRunRef` payload — rather than a host function that merely resembles
 * it. A harness that called its own worker directly would carry the blueprint's
 * metadata in a report and never execute a line of it.
 *
 * `researchProbes.queue = 'unavailable'` is the OTHER branch the package
 * documents: the request is persisted, the answer is still 202, `enqueued` is
 * false, and no run exists until a reconciliation sweep re-enqueues it.
 */
function inlineEnqueue(): {
  run: (clientId: string, requestId: string) => Promise<{ enqueued: boolean }>;
  bind: (jobs: readonly BoundJob[]) => void;
} {
  let job: BoundJob | undefined;
  return {
    bind(jobs) {
      job = jobs.find((candidate) => candidate.name === 'research.run');
      if (!job) throw new Error('the research run blueprint was not bound');
    },
    async run(clientId, requestId) {
      if (researchProbes.queue === 'unavailable') return { enqueued: false };
      if (!job) throw new Error('enqueue called before the job was bound');
      // The payload is the request's IDENTITY, ids only — never the query,
      // which is derivable state a retry would otherwise carry a stale copy of.
      await job.handle({ clientId, requestId } as never, {
        logger: harnessLoggerFor('research'),
      } as never);
      return { enqueued: true };
    },
  };
}

/**
 * The ONE research route that is deliberately the host's.
 *
 * The package declares sixteen descriptors and stops short of the history
 * grid's `GET /research` listing, and says why: its query grammar and result
 * envelope come from the host's own search machinery — facets, sort keys and
 * pagination derived from a host grid config over host-named columns — so a
 * descriptor there could only restate that config or drift from it.
 *
 * The START on the same path IS the package's. So this router mounts BESIDE
 * the packaged one on the same prefix, and the two share a path while owning
 * different verbs — which is the arrangement a real adopter has and the reason
 * it is worth mounting here rather than skipping the listing entirely.
 */
export function researchListingRoutes(pg: PGlite): Hono {
  const app = new Hono();
  app.get('/research', async (c) => {
    const userId = c.req.header(RESEARCH_USER_HEADER);
    // The same refusal the packaged routes give, spelled by the host: a route
    // beside a package's is still the host's to guard, and a listing that
    // answered rows to a caller the surface next door refuses would be the
    // whole tenant's history leaking through the one endpoint nobody adopted.
    if (!userId) return c.json({ error: 'unauthenticated' }, 401);

    const clientId = c.req.param('tenantSlug') ?? RESEARCH_TENANT_ID;
    const term = c.req.query('term');
    const pageSize = Math.min(Number(c.req.query('pageSize') ?? 10) || 10, 50);
    const page = Math.max(Number(c.req.query('page') ?? 1) || 1, 1);
    const params = new Params();
    const where = [`r.client_id = ${params.add(clientId)}`];
    // The host's own matching, over the column the package's migration
    // backfilled for exactly this — and folded by the package's OWN
    // `normalizeText`, the same function that wrote the column. Two foldings
    // would index one spelling and search for another.
    if (term) where.push(`r.term_normalized LIKE ${params.add(`%${normalizeText(term)}%`)}`);
    const sql = pg as unknown as SqlRunner;
    const { rows } = await sql.query<Record<string, unknown>>(
      // The SAME columns and the SAME join the package's own request view uses
      // (`research-views.ts`) — this route is the one place a host writes that
      // wire shape by hand, so it must not be a second spelling of it.
      `SELECT ${REQUEST_VIEW_COLUMNS}
         FROM research_requests r
         ${LATEST_RUN_JOIN}
        WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC
        LIMIT ${params.add(pageSize)} OFFSET ${params.add((page - 1) * pageSize)}`,
      params.values,
    );
    // The same predicate, counted. Each clause above contributes exactly one
    // parameter and all of them are added before the page window, so the first
    // `where.length` values are precisely this query's.
    const { rows: counted } = await sql.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM research_requests r WHERE ${where.join(' AND ')}`,
      params.values.slice(0, where.length),
    );
    const total = Number(counted[0]?.total ?? 0);
    return c.json({
      data: rows.map(toRequestView),
      pagination: {
        total,
        pageCount: Math.max(Math.ceil(total / pageSize), 1),
        hasNextPage: page * pageSize < total,
      },
    });
  });
  return app;
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
