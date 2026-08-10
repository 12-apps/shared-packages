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
 * What is genuinely the HOST's, and all that is left here: which tenant, who
 * is calling, where the rows come from, and where documents are stored.
 */
import { createMemoryDataSource } from '@12-apps/report-builder';
import { reportBuilderRouter } from '@12-apps/report-builder/hono';
import {
  REPORT_ENTITY_PERMISSION,
  type ReportActor,
  type SavedReportDb,
} from '@12-apps/report-builder/server';
import type { Hono } from 'hono';

import { HARNESS_CATALOG } from './fixtures/report-catalog';
import { fixtureTables } from './fixtures/report-fixture-tables';
import { HARNESS_TIME_ZONE, NOW } from './fixtures/report-fixture-window';
import { HARNESS_CLIENT_ID } from './saved-report-db';

/** The permission tier the shipped policy assigns to `orders`. */
const SALES = 'reports:sales:read';

/**
 * What the harness user may query, DERIVED from the shipped policy rather than
 * typed out: every tier the catalog's own entities require, and nothing else.
 *
 * Typing the list is how the old fixture would have failed. An entity absent
 * from an actor's permissions is indistinguishable from an entity that does not
 * exist — both answer *Acesso negado* — so a catalog that grew an entity while
 * this list stayed still would look exactly like the bug being fixed.
 */
const PERMISSIONS: string[] = [
  ...new Set(
    Object.keys(HARNESS_CATALOG.entities).map((entity) => {
      const permission = REPORT_ENTITY_PERMISSION[entity];
      if (!permission) throw new Error(`No shipped permission tier for entity "${entity}".`);
      return permission;
    }),
  ),
];

/**
 * A built-in's type, derived from the router's own config rather than imported.
 * `SystemReportDef` lives in the package's internal `preset-types` and its
 * server barrel does not re-export it, so naming it directly is a type error.
 */
type SystemReport = NonNullable<Parameters<typeof reportBuilderRouter>[0]['systemReports']>[number];

/**
 * A built-in defined over THIS catalog rather than the shipped `SYSTEM_REPORTS`.
 * The catalog is now the product's, but a SUBSET of it — the shipped presets
 * reach for plan and promise measures this fixture deliberately leaves out, and
 * a preset that 400s is a worse fixture than one that is absent.
 */
const SYSTEM_REPORTS: SystemReport[] = [
  {
    key: 'receita-por-forma',
    title: 'Receita por forma de pagamento',
    description: 'Quanto entrou por PIX, cartão e garçom no período.',
    permission: SALES as SystemReport['permission'],
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
  canAuthor: true,
  permissions: PERMISSIONS,
};

/**
 * The reports router, mounted the way a host mounts it.
 *
 * The clock is FROZEN and passed in — the single most load-bearing line here.
 * Against the machine's clock every rolling preset would empty the moment the
 * fixture's July 2026 fell out of the last thirty days, and the cases that
 * assert an exact window ("20/06 – 25/06") would go red and stay red. Moving
 * the router to a server changes where the clock is read, not which one.
 */
export function reportsRouter(db: SavedReportDb): Hono {
  return reportBuilderRouter({
    catalog: HARNESS_CATALOG,
    adapter: ({ window }) => createMemoryDataSource(fixtureTables(window)),
    db: () => Promise.resolve(db),
    timeZone: HARNESS_TIME_ZONE,
    now: () => NOW,
    systemReports: SYSTEM_REPORTS,
    resolveActor: () => ACTOR,
  });
}
