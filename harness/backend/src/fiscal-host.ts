/**
 * The `@12-apps/fiscal` adoption (FUT-2237): the document service over the
 * package's own Prisma-backed store, its twelve routes and its three jobs —
 * bound through the wiring consumer like every other surface here.
 *
 * What is genuinely the HOST's, and all that is here:
 * - where the rows are: the ONE generated Prisma client over the harness's
 *   PGlite (the package's five models arrive in it from its own partial), with
 *   the package's own migration applied out of its tarball. The store itself —
 *   the number draws, the per-subject guard, the transitions — is the
 *   package's `createPrismaFiscalStore`;
 * - who is calling: the tenant from the PATH as the emitter profile's owner,
 *   the person from a header (none is the bridge's 401), and what they hold
 *   from a second header — the guard that checks each route's DECLARED
 *   permission, which the package leaves to its host;
 * - the ports (`fiscal-ports.ts`): an issuer that authorises everything and
 *   records each call, a reversible cipher, a Map for the XMLs, one fixed
 *   sale, an A1 reader, a notifier rendering the package's blueprints over
 *   this host's words;
 * - the clock, the UTC offset, the words SEFAZ receives, the ids.
 *
 * Everything else — the state machine, the numbering, the envelopes, the
 * refusals, the DANFE, the sweeps — is the package's, from its tarball.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PGlite } from '@electric-sql/pglite';
import { DANFE_NFCE_PT_BR } from '@12-apps/fiscal/danfe/pt-BR';
import {
  createFiscalDocuments,
  createPrismaFiscalStore,
  createSigningIdentities,
  type FiscalDocuments,
  type FiscalPrismaClient,
} from '@12-apps/fiscal/documents';
import type { FiscalHttpActor } from '@12-apps/fiscal/http';
import { fiscalManifest } from '@12-apps/fiscal/manifest';
import { fiscalServerManifest } from '@12-apps/fiscal/manifest/server';
import type { BoundJob, MountedRoute } from '@12-apps/wiring';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

import {
  fakeIssuer,
  fixedSales,
  harnessCipher,
  memoryStorage,
  readCertificateAt,
  recordingNotify,
  type FiscalNotified,
  type IssuerCall,
} from './fiscal-ports';
import type { HarnessPrismaClient } from './prisma';
import { harnessLoggerFor, honoRouterFor } from './wire-hono';

/** The package's own migrations, read out of its installed tarball. */
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../node_modules/@12-apps/fiscal/prisma/migrations/', import.meta.url),
);

/** Where `mount-surfaces.ts` hangs the router: the store's own surfaces, `/fiscal/...` beneath. */
export const FISCAL_MOUNT_PATH = '/api/admin/:tenantSlug';

/** The one store this harness issues for. */
export const FISCAL_TENANT = 'harness';

/** Who is calling: a header, as a host's session would answer. None is a 401. */
export const FISCAL_USER_HEADER = 'x-harness-user';

/** What the caller holds, comma-separated; absent, all four of the package's permissions. */
export const FISCAL_PERMISSIONS_HEADER = 'x-harness-permissions';

const ALL_PERMISSIONS: readonly string[] = fiscalManifest.permissions.ids;

/** Apply the published migrations, in name order — as a host deploy would. */
export async function applyFiscalMigrations(pg: PGlite): Promise<void> {
  const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) throw new Error(`No fiscal migrations at ${MIGRATIONS_DIR}`);
  for (const name of names) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'));
  }
}

/** Back to no fiscal rows at all — the `/__harness/reset` contract. Children first. */
export async function reseedFiscal(pg: PGlite, fiscal: HarnessFiscal): Promise<void> {
  await pg.exec(`
    DELETE FROM fiscal_document_events;
    DELETE FROM fiscal_documents;
    DELETE FROM fiscal_number_counters;
    DELETE FROM fiscal_issuing_points;
    DELETE FROM fiscal_emitter_profiles;
  `);
  fiscal.issuerCalls.length = 0;
  fiscal.notified.length = 0;
  fiscal.objects.clear();
}

interface FiscalActor extends FiscalHttpActor {
  permissions: readonly string[];
}

export interface HarnessFiscal {
  router: ReturnType<typeof honoRouterFor>;
  report: WiringReport;
  routes: readonly MountedRoute[];
  jobs: readonly BoundJob[];
  documents: FiscalDocuments;
  /** Every call the service made to the "fiscal service", in order. Nothing leaves the process. */
  issuerCalls: IssuerCall[];
  /** Every notification emitted, in this host's words. */
  notified: FiscalNotified[];
  /** The XMLs, by key. */
  objects: Map<string, string>;
  /** The clock the service and the jobs read. */
  clock: { at: Date };
}

type FiscalState = Pick<HarnessFiscal, 'issuerCalls' | 'notified' | 'objects' | 'clock'>;

function documentsFor(prisma: HarnessPrismaClient, state: FiscalState) {
  const store = createPrismaFiscalStore({ prisma: prisma as unknown as FiscalPrismaClient });
  const storage = memoryStorage(state.objects);
  const notify = recordingNotify(state.notified);
  const now = () => state.clock.at;
  let nextId = 0;
  const documents = createFiscalDocuments({
    store,
    issuer: fakeIssuer(state.issuerCalls, state.clock),
    signing: createSigningIdentities({ cipher: harnessCipher }),
    cipher: harnessCipher,
    readCertificate: readCertificateAt(state.clock),
    storage,
    sales: fixedSales,
    notify,
    now,
    utcOffset: () => '-03:00',
    // The words SEFAZ receives: the host's, 15 to 255 characters each.
    reasons: {
      contingency: 'Falha de comunicação com a SEFAZ',
      inutilization: 'Numeração não utilizada pelo sistema',
      substitution: 'Venda emitida novamente em contingência',
    },
    staleAfterMs: 5 * 60_000,
    nfceOnlineToleranceMs: 5 * 60_000,
    newId: () => `fiscal-doc-${(nextId += 1)}`,
  });
  return { documents, store, storage, notify, now };
}

/**
 * The host's guard on the permission each route DECLARES. The package names
 * the permission; checking it is the host's, and a caller lacking it gets a
 * 403 before the package's handler runs.
 */
function guarded(routes: readonly MountedRoute[]): MountedRoute[] {
  return routes.map((mounted) => {
    const permission = (mounted.route as { permission?: string }).permission;
    const handle = mounted.route.handle.bind(mounted.route);
    return {
      ...mounted,
      route: {
        ...mounted.route,
        handle: async (request: Parameters<typeof handle>[0]) => {
          const actor = request.actor as FiscalActor;
          if (permission !== undefined && !actor.permissions.includes(permission)) {
            return { status: 403, body: { error: 'FORBIDDEN', permission } };
          }
          return handle(request);
        },
      },
    } as MountedRoute;
  });
}

export function fiscalHost(prisma: HarnessPrismaClient): HarnessFiscal {
  const state: FiscalState = {
    issuerCalls: [],
    notified: [],
    objects: new Map(),
    clock: { at: new Date('2026-11-13T15:00:00.000Z') },
  };
  const { documents, store, storage, notify, now } = documentsFor(prisma, state);
  const host = createWiringHost({ name: 'harness-backend', kind: 'server', ports: { loggerFor: harnessLoggerFor } });
  host.adoptServer({
    manifest: fiscalManifest,
    server: fiscalServerManifest,
    bindings: {
      http: { mountPath: FISCAL_MOUNT_PATH, config: { documents, storage, danfeLabels: DANFE_NFCE_PT_BR } },
      jobs: { deps: { documents, store, notify, now } },
    },
  });
  const wired = host.assemble();
  return {
    // The owner comes from the PATH, as in a real host; the person and what they hold from headers.
    router: honoRouterFor(guarded(wired.routes), (c): FiscalActor | null => {
      if (!c.req.header(FISCAL_USER_HEADER)) return null;
      const held = c.req.header(FISCAL_PERMISSIONS_HEADER);
      return {
        ownerId: c.req.param('tenantSlug') ?? FISCAL_TENANT,
        permissions: held === undefined ? ALL_PERMISSIONS : held.split(','),
      };
    }),
    report: wired.report,
    routes: wired.routes,
    jobs: wired.jobs,
    documents,
    ...state,
  };
}
