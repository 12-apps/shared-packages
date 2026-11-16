/**
 * The `@12-apps/messaging` adoption: one connector engine, its WhatsApp Cloud
 * adapter, the webhook pair, and the three jobs — bound through the wiring
 * consumer like every other surface here.
 *
 * What is genuinely the HOST's, and all that is here:
 * - where the rows are: the ONE generated Prisma client over the harness's
 *   PGlite, through the package's own `createPrismaMessagingStore` (the four
 *   models arrive in it from the package's partial);
 * - the channel's secrets: a fixed app secret and verify token. A real host
 *   reads them from its secret store; an empty one refuses everything;
 * - the network: an in-memory Graph `fetch` that records every call and never
 *   leaves the process;
 * - the queue: an array the suite drains through the BOUND process-delivery job;
 * - the key behind a connection's credential (a reversible encoding, because
 *   this harness has no key to protect), the clock and the logger.
 *
 * Everything else — the inbox, the tenant resolution, the conversation states,
 * the signature check, the refusals — is the package's, from its tarball.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';
import {
  createMessagingEngine,
  createPrismaMessagingStore,
  type MessagingEngine,
  type MessagingPrismaDb,
} from '@12-apps/messaging';
import { messagingManifest } from '@12-apps/messaging/manifest';
import { messagingServerManifest } from '@12-apps/messaging/manifest/server';
import { createWhatsAppAdapter } from '@12-apps/messaging/whatsapp';
import type { BoundJob, MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

import type { HarnessPrismaClient } from './prisma';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/** The package's own migrations, read out of its installed tarball. */
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/messaging/prisma/migrations/', import.meta.url),
);

/** Where `mount-surfaces.ts` hangs the router: the package's paths are under `/api`. */
export const MESSAGING_MOUNT_PATH = '/api';

/** The Meta app's secret: every WhatsApp webhook POST is signed with it. */
export const MESSAGING_APP_SECRET = 'harness-meta-app-secret';

/** The token configured on the app's webhook subscription. */
export const MESSAGING_VERIFY_TOKEN = 'harness-verify-token';

/** The one URL the channel calls, for every tenant. */
export const MESSAGING_WEBHOOK_PATH = '/api/webhooks/messaging/whatsapp';

/** One request the engine made to the Graph API. */
export interface GraphCall {
  url: string;
  method: string;
}

/** The job the engine queues for each stored delivery. */
export interface QueuedJob {
  name: string;
  payload: unknown;
  dedupeKey?: string;
}

/** Apply the published migration, in name order — as a host deploy would. */
export async function applyMessagingMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // Zero would leave every delivery failing as "relation does not exist"
  // rather than as the packaging mistake it is.
  if (names.length === 0) throw new Error(`No messaging migrations at ${MIGRATIONS_DIR}`);
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

export interface HarnessMessaging {
  router: ReturnType<typeof honoRouterFor>;
  report: WiringReport;
  routes: readonly MountedRoute[];
  jobs: readonly BoundJob[];
  engine: MessagingEngine;
  /** Every Graph call the engine made. Nothing leaves the process. */
  graphCalls: GraphCall[];
  /** The jobs queued, in order, for the suite to run through the bound job. */
  queued: QueuedJob[];
}

export function messagingHost(prisma: HarnessPrismaClient): HarnessMessaging {
  const graphCalls: GraphCall[] = [];
  const queued: QueuedJob[] = [];
  const logger = harnessLoggerFor(messagingManifest.observability.namespace);
  const engine = createMessagingEngine({
    store: createPrismaMessagingStore(prisma as unknown as MessagingPrismaDb),
    adapters: [
      createWhatsAppAdapter({
        appSecret: MESSAGING_APP_SECRET,
        verifyToken: MESSAGING_VERIFY_TOKEN,
        graph: {
          baseUrl: 'https://graph.harness.invalid',
          apiVersion: 'v23.0',
          fetch: async (url, init) => {
            graphCalls.push({ url, method: init.method });
            return { status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.harness' }] }) };
          },
        },
      }),
    ],
    // A reversible encoding: this harness holds no key worth protecting.
    secrets: {
      seal: (plaintext) => `harness:${Buffer.from(plaintext).toString('base64')}`,
      open: (sealed) => Buffer.from(sealed.replace(/^harness:/u, ''), 'base64').toString(),
    },
    enqueue: {
      enqueue: async (name, payload, options) => {
        queued.push({ name, payload, ...(options?.dedupeKey ? { dedupeKey: options.dedupeKey } : {}) });
        return { enqueued: true };
      },
    },
    clock: { now: () => new Date() },
    logger,
  });

  const host = createWiringHost({ name: 'harness-backend', kind: 'server', ports: { loggerFor: harnessLoggerFor } });
  host.adoptServer({
    manifest: messagingManifest,
    server: messagingServerManifest,
    bindings: {
      http: { mountPath: MESSAGING_MOUNT_PATH, config: { engine, logger } },
      jobs: { deps: { engine } },
    },
  });
  const wired = host.assemble();
  return {
    // Both routes are webhooks: the channel authenticates by signature, so the
    // bridge asks no actor and this one is never consulted.
    router: honoRouterFor(wired.routes, () => null),
    report: wired.report,
    routes: wired.routes,
    jobs: wired.jobs,
    engine,
    graphCalls,
    queued,
  };
}
