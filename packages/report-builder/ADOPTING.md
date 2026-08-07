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
| **Server** | `@12-apps/report-builder/server` | Call `createApiReportBuilder(config)` and mount the `routes` it returns — the eight endpoints, their parsing, their statuses and their envelope all live here. The host supplies only what is its own: a `ReportActor` (auth + tenant + permission ids), a window-scoped adapter and a lazy DB provider. Also provides the domain catalog + system presets, the entity→permission policy and the **wire (zod) contract** the host's MCP registry imports. |
| **Hono** | `@12-apps/report-builder/hono` | `app.route(prefix, reportBuilderRouter({ ...serverConfig, resolveActor }))`. A one-call mount for hosts on Hono; `hono` is an OPTIONAL peer, so importing the root or `/server` never resolves it. |
| **React** | `@12-apps/report-builder/react` | Call `createWebReportBuilder({ tenantSlug })` and mount the `page` it returns. Screens, flows and the routes between them are all inside; the host writes no route table. Nest the built-ins in your menu from `SYSTEM_REPORT_NAV`. |
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
3. **The host owns auth, tenant attribution and RBAC — and nothing else.**
   Handlers never read sessions. The host resolves a `ReportActor`
   (`clientId`, `userId`, `roleIds`, `isAdmin`, `canAuthor`, `permissions`)
   and the package narrows against it. `permissions` is REQUIRED and is not
   defaulted: a host that forgot it gets an empty surface rather than the
   whole catalog. Entitlements and quota stay the host's too — they are
   billing questions, answered before the request reaches a descriptor.
4. **The adapter is a FACTORY, not an instance.** `adapter` may be a plain
   `ReportDataSource` (fixtures that do not move), but a real host passes
   `({ actor, window }) => createTenantReportDataSource(actor.clientId, window)`.
   The window has to reach the database, or "last 7 days" quietly reads all of
   history and filters it in memory.
5. **The period is the package's.** `?preset=today|7d|30d|custom&from&to` is
   resolved by `resolveReportRange` on the tenant's clock and echoed on every
   response. A host resolving its own window would disagree with the buckets
   the report truncates on — that is the same-clock rule, and both ends have
   to name it for either to matter.
6. **Wire schemas are the single source of truth.** The handlers validate with
   and the MCP registry advertises exactly the schemas exported by `./server`
   (`runReportBody`, `reportRangeQuery`, result schemas…). Only paths,
   operation ids and summaries are host-owned.
7. **Specs are data, never code.** Everything is validated against the field
   catalog on every write and run; row output is capped
   (`REPORT_RUN_MAX_ROWS`).

## The endpoints

Mounted under whatever prefix the host chooses (future-pay uses
`/api/admin/:tenantSlug`):

| Method | Path | Notes |
|---|---|---|
| GET | `/reports/fields` | Catalog, narrowed by permission. 403 when the actor reaches no entity. |
| GET | `/reports/system` | Built-ins the actor may run. 403 when none. |
| GET | `/reports/system/:key` | Runs one for the period. 404 unknown key, before any permission check. |
| GET | `/reports/custom` | Saved documents, narrowed by lifecycle AND by entity. |
| GET | `/reports/custom/:id` | Opens AND runs it. 404 — never 403 — when the actor may not see it. |
| POST | `/reports/custom` | 200 with the summary; 409 on a duplicate name. |
| PUT | `/reports/custom/:id` | Omitted lifecycle fields keep their stored values. |
| DELETE | `/reports/custom/:id` | 204, with no body. |
| POST | `/reports/run` | Dry run. The entity check happens before the spec reaches the adapter. |

## Host wiring, end to end

```ts
// backend (Hono)
app.route(
  '/api/admin/:tenantSlug',
  reportBuilderRouter({
    catalog: reportCatalog,
    adapter: ({ actor, window }) => createTenantReportDataSource(actor.clientId, window),
    db: () => getSavedReportDb(),
    timeZone: PLATFORM_TIME_ZONE,
    resolveActor: (c) => resolveReportActor(c),   // auth + RBAC: the host's
  }),
);

// frontend
const { page } = createWebReportBuilder({ tenantSlug });
```

Everything else — MCP registry paths/summaries, the nav entries built from
`SYSTEM_REPORT_NAV` — remains host-owned.

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
3. Implement nothing: pass your Prisma client through the structural seams,
   mount `createApiReportBuilder(...).routes` (or the Hono router) behind your own
   `resolveActor`, spread the wire schemas into your MCP registry, and mount
   the React component with your tenant slug.
4. Optional: replace `reportCatalog`/`SYSTEM_REPORTS` with your own
   `defineCatalog` model — the engine and UI are catalog-driven.
