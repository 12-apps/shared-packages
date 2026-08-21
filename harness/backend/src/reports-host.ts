/**
 * Everything `@12-apps/report-builder` needs from a HOST, in one object.
 *
 * This is the wiring that used to live in the browser
 * (`harness/frontend/src/lib/memory-backend.ts`), where Hono's isomorphism let
 * `router.request()` answer the surface with no socket in between. That was a
 * true test of the CONTRACT and a false picture of a consumer: hitting Save
 * produced no network request at all, and a reload threw the work away,
 * because there was nothing on the other side of anything.
 *
 * Nothing about the host's obligations changed in moving it — same catalog,
 * same actor, same built-ins, same frozen clock. What changed is that they are
 * now supplied by a process the browser has to reach over HTTP.
 *
 * What is genuinely the HOST's, and all that is left here: which tenant, who is
 * calling, where the rows come from, where documents are stored — and, since
 * the package stopped shipping one application's answers, the VOCABULARY: which
 * permission reaches each entity, which built-ins exist, which starter each
 * entity opens with, and which clock a day is measured on.
 */
import { PT_BR_REPORT_ENGINE_COPY } from '@12-apps/report-builder';
import { PT_BR_REPORT_SERVER_MESSAGES } from '@12-apps/report-builder/server';
import { createMemoryDataSource, reportSpecSchema, type ReportSpec } from '@12-apps/report-builder';
import { reportBuilderManifest } from '@12-apps/report-builder/manifest';
import { reportBuilderServerManifest } from '@12-apps/report-builder/manifest/server';
import {
  type ReportActor,
  type SavedReportDb,
  type SystemReportDef,
} from '@12-apps/report-builder/server';
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';
import type { MountedRoute, WireMcpTool } from '@12-apps/wiring';
import type { Hono } from 'hono';

import { HARNESS_CATALOG } from './fixtures/report-catalog';
import { fixtureTables } from './fixtures/report-fixture-tables';
import { HARNESS_TIME_ZONE, NOW } from './fixtures/report-fixture-window';
import { HARNESS_CLIENT_ID } from './saved-report-db';
import { honoRouterFor, harnessLoggerFor } from './wire-hono';

/** This host's own tiers, over this host's own entities. */
const SALES = 'reports:sales:read';
const STOCK = 'stock:read';
const KITCHEN = 'reports:kitchen:read';

/** The package's own id, the one it gates authoring with by default. */
const AUTHOR = 'reports:manage';

/**
 * Which permission reaches each entity — this host's map, REQUIRED by the mount
 * and checked against the catalog when the router is built.
 *
 * It used to be imported: `REPORT_ENTITY_PERMISSION`, seven entries the package
 * shipped, and the actor's grants were derived from it so that "a catalog that
 * grew an entity" could not silently fall out of the fixture. The derivation
 * was sound and the source was not — a package cannot own the policy over a
 * host's tables. The completeness property it protected is now the package's
 * own assembly check, which refuses a catalog entity this map does not name.
 */
const ENTITY_PERMISSION: Record<string, string> = {
  orders: SALES,
  order_items: SALES,
  payments: SALES,
  stock_movements: STOCK,
  loss_events: STOCK,
  kitchen_ticket_items: KITCHEN,
  kitchen_shifts: KITCHEN,
};

/** Every tier this host's catalog requires, plus the right to author. */
const PERMISSIONS: string[] = [...new Set(Object.values(ENTITY_PERMISSION)), AUTHOR];

/**
 * A built-in defined over THIS host's catalog — the only kind there is now that
 * the package ships none. `SystemReportDef` is exported from the server barrel;
 * it used to be internal to `preset-types`, which is why this was a derived
 * type before.
 */
const SYSTEM_REPORTS: SystemReportDef[] = [
  {
    key: 'receita-por-forma',
    title: 'Receita por forma de pagamento',
    description: 'Quanto entrou por PIX, cartão e garçom no período.',
    permission: SALES,
    section: 'orders',
    supportsGrain: false,
    presentation: 'chart',
    build: () =>
      ({
        entity: 'orders',
        dimensions: [{ field: 'method' }],
        measures: [{ field: 'revenueCents' }],
        filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
        presentation: { kind: 'chart', chartType: 'bar' },
      }) as never,
  },
];

/**
 * The known-good spec each entity opens with, served on `/reports/fields`.
 *
 * The package used to ship one per origin-host entity (`REPORT_ENTITY_STARTERS`)
 * and serve them to any catalog whose entity names happened to match. A host
 * declares its own; the mount compile-checks them against this catalog, so a
 * starter naming a field this fixture does not have fails at boot.
 */
const HARNESS_STARTERS: Record<string, ReportSpec> = Object.fromEntries(
  Object.entries({
    orders: {
      entity: 'orders',
      dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
      measures: [{ field: 'revenueCents', aggregation: 'sum', alias: 'receita' }],
      filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
      presentation: { kind: 'chart', chartType: 'line' },
    },
    order_items: {
      entity: 'order_items',
      dimensions: [{ field: 'productName' }],
      measures: [{ field: 'revenueCents', aggregation: 'sum', alias: 'receita' }],
      sort: [{ by: 'receita', direction: 'desc' }],
      limit: 10,
      presentation: { kind: 'chart', chartType: 'bar' },
    },
    payments: {
      entity: 'payments',
      dimensions: [{ field: 'method' }],
      measures: [{ field: 'amountCents', aggregation: 'sum', alias: 'valor' }],
      filters: [{ field: 'status', operator: 'eq', value: 'PAID' }],
      presentation: { kind: 'chart', chartType: 'pie' },
    },
    stock_movements: {
      entity: 'stock_movements',
      dimensions: [{ field: 'type' }],
      measures: [{ field: 'quantityDelta', aggregation: 'sum', alias: 'quantidade' }],
      presentation: { kind: 'chart', chartType: 'bar' },
    },
    loss_events: {
      entity: 'loss_events',
      dimensions: [{ field: 'reasonName' }],
      measures: [{ field: 'lossValueCents', aggregation: 'sum', alias: 'valor_perdido' }],
      presentation: { kind: 'chart', chartType: 'bar' },
    },
    // Starts on the STATION, never on the cook: grouping by an identity
    // dimension is refused unless every measure declares a suppression floor,
    // so a per-cook starter would open with a spec the compiler rejects.
    kitchen_ticket_items: {
      entity: 'kitchen_ticket_items',
      dimensions: [{ field: 'stationName' }],
      measures: [
        { field: 'prepSeconds', aggregation: 'p90', alias: 'preparo_p90' },
        { field: 'lines', aggregation: 'sum', alias: 'linhas' },
      ],
      sort: [{ by: 'linhas', direction: 'desc' }],
      presentation: { kind: 'table' },
    },
    kitchen_shifts: {
      entity: 'kitchen_shifts',
      dimensions: [{ field: 'stationName' }],
      measures: [
        { field: 'laborSeconds', aggregation: 'sum', alias: 'horas' },
        { field: 'outputLines', aggregation: 'sum', alias: 'linhas' },
      ],
      sort: [{ by: 'horas', direction: 'desc' }],
      presentation: { kind: 'table' },
    },
  }).map(([entity, input]) => [entity, reportSpecSchema.parse(input)]),
);

/**
 * The one caller this harness has: an owner of the `harness` tenant.
 *
 * `clientId` is what every stored document is scoped by, so it has to be the
 * same string the seeded rows carry — hence importing it rather than restating
 * it beside them.
 */
const ACTOR: ReportActor = {
  clientId: HARNESS_CLIENT_ID,
  userId: 'u1',
  roleIds: [],
  isAdmin: true,
  permissions: PERMISSIONS,
};

/** Where `mount-surfaces.ts` hangs the reports router — the adoption's claim. */
export const REPORTS_MOUNT_PATH = '/api/admin/:tenantSlug';

/**
 * The reports surface, adopted through `@12-apps/wiring/consumer` (12-27).
 *
 * The config object is the SAME one the per-package Hono adapter used to
 * take — bindings are typed from the manifest's own factory, so nothing about
 * the host's obligations changed. What changed is who counts them: the
 * consumer refuses an unanswered capability, conflict-checks the route
 * claims, and answers a wiring report a test can pin. The bridge
 * (`wire-hono.ts`) is the host's one framework adapter, shared by every
 * adopted package instead of shipped per package.
 *
 * The clock is FROZEN and passed in — the single most load-bearing line here.
 * Against the machine's clock every rolling preset would empty the moment the
 * fixture's July 2026 fell out of the last thirty days, and the cases that
 * assert an exact window ("20/06 – 25/06") would go red and stay red. Moving
 * the router behind the consumer changes where the mount is counted, not
 * which clock a day is measured on.
 */
export function wireReports(db: SavedReportDb): {
  router: Hono;
  report: WiringReport;
  routes: readonly MountedRoute[];
  mcpEndpoints: readonly WireMcpTool[];
} {
  const host = createWiringHost({
    name: 'harness-backend',
    kind: 'server',
    // The reference consumer shows the BOUND path: one namespaced logger
    // factory for every adopted package. The harness's sink is the console.
    ports: { loggerFor: harnessLoggerFor },
  });
  host.adoptServer({
    manifest: reportBuilderManifest,
    server: reportBuilderServerManifest,
    // The declared world is the FRONTEND harness's to run — the journeys
    // drive screens. Declining here (with the reason in the report) is the
    // honest server-host answer; silence would be a red assemble().
    e2e: { declined: 'the journeys drive screens — the web harness answers for the world' },
    bindings: {
      http: {
        mountPath: REPORTS_MOUNT_PATH,
        config: {
          catalog: HARNESS_CATALOG,
          adapter: ({ window }) => createMemoryDataSource(fixtureTables(window)),
          // Named, not inherited — the package ships no default sentence, so
          // this is where this host's Portuguese is chosen.
          copy: PT_BR_REPORT_ENGINE_COPY,
          messages: PT_BR_REPORT_SERVER_MESSAGES,
          db: () => Promise.resolve(db),
          timeZone: HARNESS_TIME_ZONE,
          now: () => NOW,
          entityPermission: ENTITY_PERMISSION,
          systemReports: SYSTEM_REPORTS,
          starters: HARNESS_STARTERS,
        },
      },
    },
  });
  const wired = host.assemble();
  return {
    router: honoRouterFor(wired.routes, () => ACTOR),
    report: wired.report,
    routes: wired.routes,
    mcpEndpoints: wired.mcpEndpoints,
  };
}

/** The mounted router alone, for `mount-surfaces.ts` — same shape as before. */
export function reportsRouter(db: SavedReportDb): Hono {
  return wireReports(db).router;
}
