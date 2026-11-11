/**
 * The `@12-apps/marketplace` adoption: one marketplace engine, its iFood
 * adapter, the webhook and the six authenticated routes, and the four jobs —
 * bound through the wiring consumer like every other surface here.
 *
 * What is genuinely the HOST's, and all that is here:
 * - where the rows are: the ONE generated Prisma client over the harness's
 *   PGlite (the engine's four models arrive in it from the package's own
 *   partial), and its interactive `$transaction`;
 * - what an order IS: `harness_marketplace_orders`, a host table, written
 *   through the transaction client the engine hands `create`;
 * - the stock ask: `admit` refuses an accept of an order carrying the SKU
 *   `SKU-SHORT` with `MARKETPLACE_STOCK_ASK`, unless the person admitted it;
 * - the network: an IN-MEMORY HTTP fake that records every request and never
 *   leaves the process (a 200 token grant, a 202 for every order call);
 * - the queue: an array the suite drains through the BOUND outbound job;
 * - the audit trail: `harness_marketplace_audit`, written through the
 *   archive's own transaction client;
 * - the clock, the secrets (a reversible encoding, because this harness has no
 *   key to protect), the logger, and who is calling.
 *
 * Everything else — the inbox, the clock rules, the decisions, the outbound
 * bookkeeping, the envelopes, the refusals — is the package's, from its tarball.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';
import {
  createMarketplaceEngine,
  type MarketplaceDb,
  type MarketplaceEngine,
  type MarketplaceHttpRequest,
  type MarketplaceOrderPort,
  type OutboundJobPayload,
} from '@12-apps/marketplace';
import { createIfoodAdapter } from '@12-apps/marketplace/ifood';
import { IFOOD_ADAPTER_COPY_PT_BR } from '@12-apps/marketplace/ifood/pt-BR';
import { marketplaceManifest } from '@12-apps/marketplace/manifest';
import { marketplaceServerManifest } from '@12-apps/marketplace/manifest/server';
import type { MarketplaceActor } from '@12-apps/marketplace/server';
import { MARKETPLACE_SERVER_COPY_EN_US } from '@12-apps/marketplace/server/en-US';
import type { BoundJob, MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

import type { HarnessPrismaClient } from './prisma';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/** The package's own migrations, read out of its installed tarball. */
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/marketplace/prisma/migrations/', import.meta.url),
);

/** Where `mount-surfaces.ts` hangs the router: the package's paths are under `/api`. */
export const MARKETPLACE_MOUNT_PATH = '/api';

/** The one store this harness sells through a marketplace. */
export const MARKETPLACE_TENANT = 'harness';

/** The SKU the host's stock says is short. */
export const SHORT_SKU = 'SKU-SHORT';

/** Who is calling, for the audit line: a header, as a host's session would answer. */
export const MARKETPLACE_USER_HEADER = 'x-harness-user';

/** Apply the published migrations, in name order — as a host deploy would. */
export async function applyMarketplaceMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) throw new Error(`No marketplace migrations at ${MIGRATIONS_DIR}`);
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
  // The HOST's own tables: what an order is here, and the audit trail.
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS harness_marketplace_orders (
      id          TEXT PRIMARY KEY,
      client_id   TEXT NOT NULL,
      external_id TEXT NOT NULL,
      buyer_name  TEXT,
      total_cents INTEGER NOT NULL,
      short       BOOLEAN NOT NULL,
      status      TEXT NOT NULL,
      created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS harness_marketplace_audit (
      id        SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      actor_id  TEXT,
      action    TEXT NOT NULL,
      provider  TEXT NOT NULL,
      reason    TEXT
    );
  `);
}

/** A Prisma client (the root one or a transaction's) as the raw-SQL seam this host writes through. */
type RawClient = Pick<HarnessPrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe'>;
const raw = (db: MarketplaceDb): RawClient => db as unknown as RawClient;

export interface HarnessMarketplace {
  router: ReturnType<typeof honoRouterFor>;
  report: WiringReport;
  routes: readonly MountedRoute[];
  jobs: readonly BoundJob[];
  engine: MarketplaceEngine;
  /** Every request the engine made to the "marketplace", in order. Nothing leaves the process. */
  requests: MarketplaceHttpRequest[];
  /** The outbound jobs queued, in order, for the suite to run through the bound job. */
  queued: OutboundJobPayload[];
  /** The clock the engine reads. */
  clock: { at: Date };
}

/** The in-memory marketplace: a token grant, and 202 for every order call. */
function fakeMarketplaceHttp(requests: MarketplaceHttpRequest[]) {
  return async (request: MarketplaceHttpRequest) => {
    requests.push(request);
    if (request.url.endsWith('/token')) {
      return { status: 200, body: JSON.stringify({ accessToken: 'harness-token', expiresIn: 3600 }) };
    }
    return { status: 202, body: '' };
  };
}

/** What an order is HERE: a row of `harness_marketplace_orders`, and its stock ask. */
function hostOrders(prisma: HarnessPrismaClient): MarketplaceOrderPort {
  return {
    admit: async ({ orderId, decision, admission, db }) => {
      if (decision !== 'ACCEPT' || admission.admitStockPastZero) return { admitted: true };
      const rows = await raw(db).$queryRawUnsafe<{ short: boolean }[]>(
        'SELECT short FROM harness_marketplace_orders WHERE id = $1',
        orderId,
      );
      return rows[0]?.short
        ? { admitted: false, code: 'MARKETPLACE_STOCK_ASK', message: 'Short of an item.', details: { short: [SHORT_SKU] } }
        : { admitted: true };
    },
    create: async (clientId, order, lines, db) => {
      const id = `mp-${order.externalOrderId}`;
      await raw(db).$executeRawUnsafe(
        `INSERT INTO harness_marketplace_orders (id, client_id, external_id, buyer_name, total_cents, short, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
        id,
        clientId,
        order.externalOrderId,
        order.buyer.name,
        order.totalCents,
        lines.some((line) => line.externalSku === SHORT_SKU),
      );
      return id;
    },
    catalogHas: async () => true,
    onAccepted: async (_clientId, orderId) => {
      await prisma.$executeRawUnsafe("UPDATE harness_marketplace_orders SET status = 'ACCEPTED' WHERE id = $1", orderId);
    },
    onRefused: async (_clientId, orderId, reason) => {
      await prisma.$executeRawUnsafe('UPDATE harness_marketplace_orders SET status = $2 WHERE id = $1', orderId, reason);
    },
    summarize: async (_clientId, orderIds) => {
      const rows = await prisma.$queryRawUnsafe<{ id: string; buyer_name: string | null; total_cents: number }[]>(
        'SELECT id, buyer_name, total_cents FROM harness_marketplace_orders WHERE id = ANY($1)',
        [...orderIds],
      );
      return new Map(
        rows.map((row) => [row.id, { buyerName: row.buyer_name, totalCents: row.total_cents, unmappedLines: 0, createdAt: null }]),
      );
    },
  };
}

function engineFor(prisma: HarnessPrismaClient, state: Pick<HarnessMarketplace, 'requests' | 'queued' | 'clock'>) {
  const root = prisma as unknown as MarketplaceDb;
  const transaction = prisma['$transaction'] as <T>(fn: (tx: MarketplaceDb) => Promise<T>) => Promise<T>;
  return createMarketplaceEngine({
    db: async () => root,
    transaction: (fn) => transaction.call(prisma, fn),
    order: hostOrders(prisma),
    // A reversible encoding: this harness holds no key worth protecting.
    secrets: {
      seal: (plaintext) => `harness:${Buffer.from(plaintext).toString('base64')}`,
      open: (sealed) => Buffer.from(sealed.replace(/^harness:/u, ''), 'base64').toString(),
    },
    http: fakeMarketplaceHttp(state.requests),
    enqueue: {
      enqueue: async (_name, payload) => {
        state.queued.push(payload as OutboundJobPayload);
        return { enqueued: true };
      },
    },
    audit: {
      record: async (entry, db) => {
        await raw(db).$executeRawUnsafe(
          'INSERT INTO harness_marketplace_audit (client_id, actor_id, action, provider, reason) VALUES ($1, $2, $3, $4, $5)',
          entry.clientId,
          entry.actorId,
          entry.action,
          entry.provider,
          entry.reason,
        );
      },
    },
    clock: { now: () => state.clock.at },
    logger: harnessLoggerFor(marketplaceManifest.observability.namespace),
    publishChanged: () => undefined,
    defaultAckSlaSeconds: 300,
    reconcileBatchSize: 50,
    maxInboxAttempts: 5,
    adapters: [createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_PT_BR })],
  });
}

export function marketplaceHost(prisma: HarnessPrismaClient): HarnessMarketplace {
  const state = { requests: [] as MarketplaceHttpRequest[], queued: [] as OutboundJobPayload[], clock: { at: new Date('2026-11-11T12:00:00.000Z') } };
  const engine = engineFor(prisma, state);
  const host = createWiringHost({ name: 'harness-backend', kind: 'server', ports: { loggerFor: harnessLoggerFor } });
  host.adoptServer({
    manifest: marketplaceManifest,
    server: marketplaceServerManifest,
    bindings: {
      http: {
        mountPath: MARKETPLACE_MOUNT_PATH,
        config: {
          engine,
          // Passed BY HAND — the routes also answer the MCP, whose text is English.
          copy: MARKETPLACE_SERVER_COPY_EN_US,
          tenantBySlug: async (slug: string) => (slug === MARKETPLACE_TENANT ? MARKETPLACE_TENANT : null),
          logger: harnessLoggerFor(marketplaceManifest.observability.namespace),
        },
      },
      jobs: { deps: { engine } },
    },
  });
  const wired = host.assemble();
  return {
    // The tenant comes from the PATH, as in a real host; the user from a header.
    router: honoRouterFor(wired.routes, (c): MarketplaceActor => ({
      clientId: c.req.param('tenantSlug') ?? MARKETPLACE_TENANT,
      userId: c.req.header(MARKETPLACE_USER_HEADER) ?? null,
    })),
    report: wired.report,
    routes: wired.routes,
    jobs: wired.jobs,
    engine,
    ...state,
  };
}
