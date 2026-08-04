# Adopting @12-apps/report-builder

This package is a **plug-and-play reporting plugin**: one library, reusable
across repositories, exposing standardized surfaces. A host repo only *points*
at these surfaces — when the library updates, every host updates with **no app
changes**. The contract below is the same one `@12-apps/payments-backend` /
`-frontend` established; treat it as the standard for every plugin of this
kind.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core engine** | `@12-apps/report-builder` | Nothing to wire — pure spec → IR → rows → render pipeline (`runReport`, `defineCatalog`, `createMemoryDataSource`). |
| **Server** | `@12-apps/report-builder/server` | Mount thin route handlers: guard the request (auth is HOST-owned), resolve `tenantId`, and delegate. Provides the domain catalog + system presets, the entity→permission policy, the **duck-typed** Prisma DataSource/stores, and the **wire (zod) contract** the host's routes AND MCP registry import — schemas authored once, no drift. |
| **React** | `@12-apps/report-builder/react` | Mount three pages under the host's tenant chrome, passing only `tenantSlug`: `ReportsPage` (the Relatórios area — pick an authored report, read it, edit or archive it), `ReportEditorPage` (the same canvas, inline-editable) and `SystemReportPage` (one built-in report). Also nest the built-ins in your menu from `SYSTEM_REPORT_NAV`. Routing (react-router peer) and same-origin fetching are self-contained. |
| **Prisma** | `prisma/report-builder.prisma` + `prisma/migrations/*` | Run `pnpm --filter @12-apps/report-builder prisma:sync` once: the model + migrations reach the host's schema folder as **committed symlinks**. Never copy them. |

## Host wiring rules (the ones that bite)

1. **Declare the dependency where the schema lands.** The host package owning
   the Prisma schema folder (here `@12-apps/shared-helpers`) MUST declare this
   package as a dependency: symlinks are invisible to the dependency graph, so
   `turbo prune --docker` would otherwise drop the package and dangle every
   link at deploy (see the #336 CD incident; `package.test.ts` gates this).
2. **Duck-typed DB, never a generated client.** The server surface takes the
   host's Prisma client through structural interfaces (`ReportSourceDb`,
   `SavedReportDb`). The package never imports a generated client, so any
   host's client instance plugs in: pass a lazy provider
   (`() => Promise<db>`).
3. **The host owns auth and tenant attribution.** Handlers never read
   sessions. Routes guard first (`requireTenant*`), resolve `tenantId`, check
   `REPORT_ENTITY_PERMISSION[entity]`, then call the package.
4. **Wire schemas are the single source of truth.** Routes validate with and
   the MCP registry advertises exactly the schemas exported by `./server`
   (`runReportBody`, `reportRangeQuery`, result schemas…). Only paths,
   operation ids and summaries are host-owned.
5. **Specs are data, never code.** Everything is validated against the field
   catalog on every write and run; row output is capped
   (`REPORT_RUN_MAX_ROWS`).

## Future-pay reference wiring

- Routes: `apps/web/app/api/admin/[tenantSlug]/reports/**` (thin: guard →
  package).
- MCP: `apps/web/lib/mcp/registry/reports.ts` (thin: package schemas +
  host paths/summaries).
- DB binding: `apps/web/lib/repositories/reports/{adapter,saved}.ts`
  (lazy `getPrismaClient()` through the structural seams).
- UI mounts: `apps/admin/src/pages/reports/index.tsx` (one-line wrappers
  passing `tenantSlug`) + `apps/admin/src/shell/nav-config.ts`, which nests
  `SYSTEM_REPORT_NAV` under the section each built-in analyses.

## The two kinds of report (FUT-391)

- **Built-in ("system") reports** are fixed views OF an admin area. They are
  NOT listed in the Relatórios area: the host nests them in its lateral menu
  under the matching section (`SYSTEM_REPORT_NAV[].section`), gated by each
  entry's own `permission`, and mounts `SystemReportPage` at
  `/{tenantSlug}/reports/system/{key}`.
- **Authored reports** are dashboard documents: N blocks on a 12-column
  canvas, composed inline on the canvas they are read on. Widths are clamped
  per presentation (`minSpanForPresentation`) so a block is never narrower
  than it can render at. Retiring one is a lifecycle change (`status:
  'archived'`), never a delete.

## Porting to another repo

1. Add the workspace package (or publish it) and run `prisma:sync` against
   your schema folder (adjust `HOST_*` in
   `scripts/sync-report-builder-schema.mjs` if your layout differs).
2. Declare the package as a dependency of your schema-owning package.
3. Implement nothing: pass your Prisma client to
   `createTenantReportDataSource`/`createSavedReportStore`, mount the routes
   with your auth guards, spread the wire schemas into your MCP registry, and
   mount the React pages with your tenant slug.
4. Optional: replace `reportCatalog`/`SYSTEM_REPORTS` with your own
   `defineCatalog` model — the engine and UI are catalog-driven.
