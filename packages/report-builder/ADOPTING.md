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
| **Server** | `@12-apps/report-builder/server` | Call `createApiReportBuilder(config)` and mount the `routes` it returns — the eight endpoints, their parsing, their statuses and their envelope all live here. The host supplies everything that is its own: a `ReportActor` (auth + tenant + permission ids), the **field catalog**, the **permission each entity requires**, the **built-in reports**, the **starters**, the tenant **clock**, a window-scoped adapter and a lazy DB provider. Also provides the **wire (zod) contract** the host's MCP registry imports, and `REPORT_BUILDER_PERMISSIONS` — the one permission this package's own surface gates with. |
| **Hono** | `@12-apps/report-builder/hono` | `app.route(prefix, reportBuilderRouter({ ...serverConfig, resolveActor }))`. A one-call mount for hosts on Hono; `hono` is an OPTIONAL peer, so importing the root or `/server` never resolves it. |
| **React** | `@12-apps/report-builder/react` | Call `createWebReportBuilder({ tenantSlug, surface })` and mount the `page` it returns. Screens, flows and the routes between them are all inside; the host writes no route table. `surface` is the host's vocabulary — its built-ins, dashboards, menu sections, block templates and clock — and the same list feeds its own menu. |
| **Prisma** | `prisma/report-builder.prisma` + `prisma/migrations/*` | Run `pnpm --filter @12-apps/report-builder prisma:sync -- <host schema dir>`: the partial is **COPIED** into the host's multi-file schema folder — never symlinked (a symlinked migration is silently skipped by Prisma, a symlinked partial dangles under `turbo prune`, and `npm pack` drops it from the tarball). Migrations are discovered structurally from the installed package's `prisma/migrations` by the host's plugin-migration sync. |
| **E2E journeys** | `@12-apps/report-builder/e2e` | Implement `defineReportsWorld({ ... })` in a module inside your own playwright-bdd `steps` glob, then add `reportsFeatures` / `reportsFeaturesRoot` / `reportsSteps` to `defineBddConfig`. The Gherkin ships HERE; nothing is copied, so a scenario added upstream runs on your next version bump. See *The journeys ship with the package* below. |

## Migrating 5.4.x → 5.5.0 — the host now declares its own WORDS (FUT-760)

4.0.0 moved the host's DATA out of this package. This move is the same argument
one level down: its **copy**.

**It is a MINOR, despite being breaking.** This repo maps a `BREAKING CHANGE:`
footer and the `!` shorthand alike to a minor; only an explicit `RELEASE-MAJOR`
line spends a major, and this change does not carry one. So the upgrade is
5.4.x → 5.5.0 and every signature below still changes — read the table before
bumping the pin.

Fourteen files compiled in pt-BR — the spec sentence a block is described by
(`soma de receita em pedidos por data`), the column, axis and series headings,
the eight reasons a presentation cannot draw a shape, the two words a boolean
cell reads as, and every sentence the API refuses a request with. None of it was
configurable, so a host with another audience published one product's Portuguese
and nothing failed to say so.

**Nothing changes on screen or on the wire if you adopt the packs.** They are the
retired wording, verbatim.

### What every host must add

```ts
import {
  PT_BR_REPORT_ENGINE_COPY,          // '@12-apps/report-builder'
} from '@12-apps/report-builder';
import {
  PT_BR_REPORT_SERVER_MESSAGES,      // '@12-apps/report-builder/server'
  PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
} from '@12-apps/report-builder/server';

createApiReportBuilder({ …, copy: PT_BR_REPORT_ENGINE_COPY,
                            messages: PT_BR_REPORT_SERVER_MESSAGES });

createWebReportBuilder({ …, copy: { engine: PT_BR_REPORT_ENGINE_COPY,
                                    blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY } });
```

Pass the **same** `ReportEngineCopy` object to both halves, or an export and the
screen it came from can disagree about a column heading.

### Changed signatures

Every display function now takes the copy it renders. The copy argument is LAST
except where noted.

| before | after |
|---|---|
| `specSentence(spec, catalog)` | `specSentence(spec, catalog, copy.spec)` |
| `autoTitle(spec, catalog)` | `autoTitle(spec, catalog, copy.spec)` |
| `renderReport(query, presentation, catalog, rows)` | `…, rows, copy.labels)` |
| `toKpiModel(query, presentation, catalog, rows)` | `…, rows, copy.labels)` |
| `measureLabel(field, measure)` | `measureLabel(field, measure, copy.labels)` |
| `dimensionLabel(field, alias, timeGrain?)` | `dimensionLabel(field, alias, copy.labels, timeGrain?)` — copy is 3rd, `timeGrain` stays optional and last |
| `formatReportValue(value, format)` | `formatReportValue(value, format, copy.values)` |
| `presentationCompatibility(shape)` | `presentationCompatibility(shape, copy.presentation)` |
| `stackedCompatibility(option, shape)` | `stackedCompatibility(option, shape, copy.presentation)` |
| `resolveReportRange(input, now, timeZone?)` | `resolveReportRange(input, now, messages.range, timeZone?)` — messages is 3rd |
| `blockTemplateGroups(groups)` | `blockTemplateGroups(groups, blankTemplateCopy)` |
| `exportColumnsFor(render)` | `exportColumnsFor(render, copy.values)` |
| `runReport(spec, options)` | `options` gains a required `copy` |

### Schemas that became factories

`reportRangeQuery` and `runReportBody` carry refusal sentences, so they are now
functions of them and live in `server/wire-range.ts` (re-exported from `wire.ts`,
so the import path is unchanged):

```ts
runReportBody(PT_BR_REPORT_SERVER_MESSAGES.range).safeParse(body)
```

`saveReportBody` is unchanged — it carries no copy.

### Removed

- **`BLANK_BLOCK_TEMPLATE`** → `blankBlockTemplate(copy)`. Its two words and its
  group's heading are copy; the ids (`blank`, `em-branco`) stay the package's,
  because they are keys.
- **`REPORT_BUILDER_PERMISSIONS.labels`**. A label is copy, and shipping
  `{ reports: 'Relatórios' }` handed this product's Portuguese to every adopter
  of the id — the same call `@12-apps/rbac` made in 4.2.0. Declare the words for
  the `reports` domain and the `manage` action in your own catalog. The
  permission id itself is unchanged.

### A screen mounted outside the provider now throws

`useReportCopy` refuses rather than falling back. `useTransport` and
`useReportSurface` keep their empty answers — same-origin fetch, and a surface
with no built-ins — because those are meaningful. Copy is not: a screen with no
words is broken, and any default would be the Portuguese this release removes.
If you mount page components directly rather than through
`createWebReportBuilder`, wrap them in `ReportBuilderProvider` with a `copy`.

### The MCP manifest stays English

`REPORT_BUILDER_MCP_TOOLS` keeps module-scope English refusals. Its reader is the
agent inspecting a tool schema before it calls, not a store owner, and staying
static is what lets `manifest/index.ts` consume it. The pt-BR a person reads
still comes from the route, which answers with your `messages`.

## Migrating 3.0.1 → 4.0.0 — the host now declares its own vocabulary

**Nothing here changes a schema, a stored spec or a URL.** Every saved report,
every deep link and every MCP path keeps working. What changed is who says what.

This package used to ship an application's data: a seven-entity field catalog
of `orders` / `order_items` / `payments` / `stock_movements` / `loss_events` /
`kitchen_ticket_items` / `kitchen_shifts` with pt-BR labels, nine built-in
reports and two dashboards over them, a starter spec per entity, a block-template
picker, a Prisma DataSource reading those tables, a map from those entities to
`reports:sales:read` / `stock:read` / `reports:kitchen:read`, a `{ orders:
"Pedidos", inventory: "Estoque", kitchen: "Cozinha" }` nav label map, and
`America/Sao_Paulo` as the clock. Four of those were **defaults**, so a host
that declared none of it got all of it — another product's menu, over another
product's tables, on another country's trading day.

They are the host's, and they now arrive as config. In exchange the package
declares the one thing that IS its own and never was: the permission guarding
its editor.

### Removed exports, and what replaces each

| Removed from `/server` | Replacement |
|---|---|
| `reportCatalog` | Your own `defineCatalog({...})`, passed as `catalog`. Copy the old one out of `3.0.1`'s `src/server/catalog.ts` if you want it verbatim. |
| `REPORT_ENTITY_DATE_FIELD` | Your adapter's own map — only your adapter ever read it. |
| `REPORT_ENTITY_PERMISSION` | Required config `entityPermission`. Every catalog entity must appear; assembly throws naming the ones that do not. |
| `SYSTEM_REPORTS`, `SYSTEM_REPORT_KEYS`, `SYSTEM_REPORT_NAV`, `SYSTEM_DASHBOARDS`, `getSystemReport`, `getSystemDashboard` | Your own `SystemReportDef[]` / `SystemDashboardDef[]`, passed as `systemReports` (server) and `surface` (react). Projections: `systemReportNav(reports)`, `findSystemReport(reports, key)`, `findSystemDashboard(dashboards, key)`. |
| `REPORT_ENTITY_STARTERS` | Required config `starters` (`{}` for none), compile-checked against your catalog at assembly. |
| `blockTemplateGroups()` (no args), `findBlockTemplate` | `blockTemplateGroups(yourGroups)` — still appends the blank template. `findBlockTemplate` is gone; nothing consumed it. |
| `createTenantReportDataSource`, `ReportSourceDb`, `ReportSourceDbProvider` | Your own `ReportDataSource`. `ReportWindow`, `DateWindowWhere` and `windowWhere(window)` stay, so the half-open window is still stated once. |
| `dayOfWeekSaoPaulo`, `hourOfDaySaoPaulo` | Your adapter's own derivations, on your own zone. |
| `KITCHEN_CHEF_MIN_SAMPLE` | A number in your catalog (`minGroupSample` / `identityMinSample` are unchanged and still enforced). |
| `SystemReportPermission`, `SystemReportSection` (unions of three literals) | `permission` and `section` are `string`. `SystemReportSection` is now an INTERFACE: `{ key, label, path }`, declared in the react `surface`. |

| Removed from the root entry | Replacement |
|---|---|
| `DEFAULT_REPORT_TIME_ZONE` | Nothing. A spec or `CompileOptions` names the zone; naming neither buckets on UTC. `CompiledQuery.timeZone` is `string \| undefined` for that reason. |

| Removed from `/react` | Replacement |
|---|---|
| `SYSTEM_DASHBOARDS`, `SYSTEM_REPORT_KEYS`, `SYSTEM_REPORT_NAV` (values) | The same data, going the other way: you pass it in `surface`. The TYPES are still exported. |

### Changed shapes

- **`ReportBuilderServerConfig`** gains four required fields — `timeZone`,
  `entityPermission`, `systemReports`, `starters` — and one optional one,
  `gatePermissions`. `createApiReportBuilder` now THROWS
  (`ReportBuilderConfigError`) on a wiring mistake: an unmapped catalog entity,
  an empty `entityPermission`, a zone this runtime cannot resolve, two built-ins
  sharing a key, a built-in or starter that does not compile against your
  catalog, a starter filed under an entity that is not its own. All at assembly,
  none per request.
- **`starters` is required, and `{}` is the answer for "none".** It was the last
  vocabulary field with a `??` behind it, which is the construct this release
  exists to remove: a host that says nothing about its starters should be told
  so at the call site, not served entities without one and left to wonder.
- **`ReportActor.canAuthor` is gone.** Authoring is decided by a permission the
  actor holds: `reports:manage` by default, or whatever
  `gatePermissions.manage` names. Drop the boolean and make sure the id reaches
  `actor.permissions`.
- **A write is never wider than a read.** `PUT` / `DELETE
  /reports/custom/:id` and all three working-copy routes now re-apply the
  visibility rule `GET /reports/custom/:id` applies, and answer the same **404**
  when it refuses. This is a real behaviour change for a host granting
  `reports:manage` to non-admins: such a member can no longer overwrite,
  re-share or delete a document they cannot open. Admins (`ReportActor.isAdmin`)
  and authors are unaffected, which is every actor who could author under
  `canAuthor`.
- **`createWebReportBuilder` requires `surface`** —
  `{ systemReports, systemDashboards, sections, blockTemplates, timeZone }`.
  Every field is required; `[]` is a meaningful, complete answer for the first
  four. It throws on a built-in or a dashboard whose `section` is undeclared,
  two dashboards sharing a key, a dashboard block naming an unknown report, or
  an unresolvable zone.
- **`ReportsFixtures.blockTemplates` entries are `{ id, title }`,** not a title
  string. The `id` is the picker's own — `block-template-picker-<id>` is the
  tile — and it is stated rather than derived because the package used to derive
  it from a seven-entry title→id map of the application it was extracted from,
  and threw `unknown block template` for every title that map had never heard
  of. If you already implement `defineReportsWorld`, this is a one-line change
  in your world file.
- **`systemReportParams`'s `key` is a plain string**, not an enum of one
  product's preset keys. Narrow it to YOUR keys for your MCP surface in three
  lines, over your own definitions:

  ```ts
  const keys = MY_SYSTEM_REPORTS.map((r) => r.key) as [string, ...string[]];
  const myParams = z.object({ tenantSlug: z.string().min(1), key: z.enum(keys) });
  ```

### The permission this package contributes

```ts
import { REPORT_BUILDER_PERMISSIONS } from '@12-apps/report-builder/server';

// One id: `reports:manage` — create/edit/archive/delete a saved report, and
// every working-copy write. `{ kind: 'class' }`, not an owner marker.
const CATALOG = composePermissions(
  REPORT_BUILDER_PERMISSIONS,
  YOUR_DOMAIN_PERMISSIONS,
).withRoles({ /* your roles */ });
```

It is one id and not two on purpose. READING is already decided end to end by
your own data tiers (`entityPermission`): a document whose blocks the caller
cannot run is not listed, and an actor who reaches no entity gets 403 rather
than an empty page. A `reports:read` on top of that would be this package
writing policy into your catalog while changing nothing about what anyone sees.

If your catalog spells it differently, map it instead of adopting it:

```ts
createApiReportBuilder({ ..., gatePermissions: { manage: 'relatorios:editar' } });
```

**The one behavioural break to plan for:** an actor who could author before
because your host computed `canAuthor` from a role tier now needs the id in
`actor.permissions`. Grant it wherever that tier was, or map
`gatePermissions.manage` onto an id those actors already hold.

## Host wiring rules (the ones that bite)

1. **Declare the dependency where the schema lands.** The host package owning
   the Prisma schema folder (here `@12-apps/prisma`) MUST declare this
   package as a dependency: the copy is invisible to the dependency graph, so
   `turbo prune --docker` would otherwise drop this package from the build
   context and the sync's `--check` would exit 1 on a missing source, on a
   partial that is sitting right there, correct and committed (see the #336 CD
   incident; `package.test.ts` gates this).
2. **Duck-typed DB, never a generated client.** The server surface takes the
   host's Prisma client through structural interfaces (`ReportSourceDb`,
   `SavedReportDb`). The package never imports a generated client, so any
   host's client instance plugs in: pass a lazy provider
   (`() => Promise<db>`).
3. **The host owns auth, tenant attribution, RBAC and its own vocabulary.**
   Handlers never read sessions. The host resolves a `ReportActor`
   (`clientId`, `userId`, `roleIds`, `isAdmin`, `permissions`) and the package
   narrows against it. `permissions` is REQUIRED and is not defaulted: a host
   that forgot it gets an empty surface rather than the whole catalog — and
   since 4.0.0 it also decides AUTHORING, through `reports:manage` (or
   whatever `gatePermissions.manage` names). Entitlements and quota stay the
   host's too — they are billing questions, answered before the request
   reaches a descriptor.
4. **The adapter is a FACTORY, not an instance.** `adapter` may be a plain
   `ReportDataSource` (fixtures that do not move), but a real host passes
   `({ actor, window }) => myReportDataSource(actor.clientId, window)`.
   The window has to reach the database, or "last 7 days" quietly reads all of
   history and filters it in memory.
5. **The period is the package's; the CLOCK is the host's.**
   `?preset=today|7d|30d|month|custom&from&to` is resolved by
   `resolveReportRange` on the zone `config.timeZone` names, and echoed on
   every response. A host resolving its own window would disagree with the
   buckets the report truncates on — that is the same-clock rule, and both ends
   have to name it for either to matter. `timeZone` is required for the same
   reason: it used to fall through to `America/Sao_Paulo`, so a host in any
   other zone got a window three hours off its own day and nothing said so.
6. **Wire schemas are the single source of truth.** The handlers validate with
   and the MCP registry advertises exactly the schemas exported by `./server`
   (`runReportBody`, `reportRangeQuery`, result schemas…). Only paths,
   operation ids and summaries are host-owned.
7. **Specs are data, never code.** Everything is validated against the field
   catalog on every write and run; row output is capped
   (`REPORT_RUN_MAX_ROWS`).

## The endpoints

Mounted under whatever prefix the host chooses (the origin host uses
`/api/admin/:tenantSlug`):

| Method | Path | Notes |
|---|---|---|
| GET | `/reports/fields` | Catalog, narrowed by permission. 403 when the actor reaches no entity. |
| GET | `/reports/system` | Built-ins the actor may run. 403 when none. |
| GET | `/reports/system/:key` | Runs one for the period. 404 unknown key, before any permission check. |
| GET | `/reports/custom` | Saved documents, narrowed by lifecycle AND by entity. |
| GET | `/reports/custom/:id` | Opens AND runs it. 404 — never 403 — when the actor may not see it. |
| POST | `/reports/custom` | 200 with the summary; 409 on a duplicate name. |
| PUT | `/reports/custom/:id` | Omitted lifecycle fields keep their stored values. Leaves a parked working copy alone. 404 when the actor may not SEE it. |
| DELETE | `/reports/custom/:id` | 204, with no body. 404 when the actor may not see it. |
| PUT | `/reports/custom/:id/working-copy` | Park an in-progress edit. `spec` is NOT written. 404 when the actor may not see it; 400 unless the report is published. |
| POST | `/reports/custom/:id/working-copy/publish` | Make the edit live AND drop the parked copy, in one write. |
| DELETE | `/reports/custom/:id/working-copy` | Discard the parked edit; the published document is untouched. 404 when there is none. |

Every write on an EXISTING document answers the visibility question `GET
/reports/custom/:id` answers, with the same 404 — `reports:manage` says the
actor may author, never that they may reach a document their own `GET` hides.
| POST | `/reports/run` | Dry run. The entity check happens before the spec reaches the adapter. |

## Host wiring, end to end

Everything below is the HOST's — the catalog, the permission each of its
entities requires, the built-ins, the starters, the adapter and the clock. None
of it has a default any more, and `createApiReportBuilder` /
`createWebReportBuilder` throw at assembly naming whichever field is missing or
incoherent.

```ts
// backend (Hono)
app.route(
  '/api/admin/:tenantSlug',
  reportBuilderRouter({
    catalog: MY_CATALOG,                       // your defineCatalog({...})
    entityPermission: MY_ENTITY_PERMISSION,    // every catalog entity, no exceptions
    systemReports: MY_SYSTEM_REPORTS,          // or []
    starters: MY_STARTERS,                     // or {}
    // Your own ReportDataSource, scoped to the window this package resolved.
    adapter: ({ actor, window }) => myReportDataSource(actor.clientId, window),
    db: () => getSavedReportDb(),
    timeZone: MY_TIME_ZONE,
    // Only if your catalog spells the authoring permission its own way.
    gatePermissions: { manage: 'relatorios:editar' },
    resolveActor: (c) => resolveReportActor(c),   // auth + RBAC: the host's
  }),
);

// frontend
const { page } = createWebReportBuilder({
  tenantSlug,
  surface: {
    systemReports: MY_SYSTEM_REPORTS,   // key/title/description/permission/section
    systemDashboards: MY_DASHBOARDS,    // or []
    sections: MY_SECTIONS,              // { key, label, path } — every section named above
    blockTemplates: MY_BLOCK_TEMPLATES, // or []
    timeZone: MY_TIME_ZONE,
  },
});
```

Everything else — MCP registry paths/summaries, and the nav entries you build
from your own `SystemReportDef[]` (`systemReportNav(reports)` groups them for
you) — remains host-owned.

## The two kinds of report (FUT-391)

- **Built-in ("system") reports** are fixed views OF an admin area. They are
  NOT listed in the Relatórios area: the host nests them in its lateral menu
  under the matching section (each definition's own `section`, grouped for you
  by `systemReportNav(yourReports)`), gated by each entry's own `permission`.
  The surface routes `/{tenantSlug}/reports/system/{key}` itself — there is no
  page component left to mount by hand.
- **Authored reports** are dashboard documents: N blocks on a 12-column
  canvas, composed inline on the canvas they are read on. Widths are clamped
  per presentation (`minSpanForPresentation`) so a block is never narrower
  than it can render at. Retiring one is a lifecycle change (`status:
  'archived'`), never a delete.

## `status: 'draft'` is not a draft REVISION (FUT-755)

Two states that sound alike and must never be conflated in code or in copy:

- **`status: 'draft'`** — the report has NEVER been published. Only its author
  and tenant admins can see it at all, so editing one has nothing to protect
  and every edit is written straight through.
- **A working copy** (`working_copy`, a JSON column on `saved_reports`) — the
  author's unpublished changes to a report that IS published. Its readers are
  looking at it right now, so flipping its status would take the report down
  for the whole store; the edit is parked beside `spec` instead and the
  published version stays live until the author saves.

The editor autosaves into the working copy on a debounce, resumes it when the
report is reopened, and offers "descartar alterações" to drop it and return to
the published version. `GET /reports/custom/:id` echoes it only to a caller who
may author (`reports:manage`); every other reader gets the published document. The list summary
carries `hasUnpublishedChanges`, which is a boolean about the document, never
its content.

Nothing here is entitlement-gated: an autosave that keeps work from dying with
the browser tab is not a feature a tenant can be missing.

## The journeys ship with the package (FUT-755)

The report author's end-to-end flows — composing a report and publishing it,
the working copy that survives a new session while readers keep the published
version, the period presets and a window picked from the calendar, the
visualisations the builder refuses and why, a block's width and height, the
table view and the CSV — live in `features/*.feature` **inside this package**
and are exported through `@12-apps/report-builder/e2e`.

That is deliberate, and it is the same arrangement `@12-apps/payments-e2e`
established: a host that copies the scenarios has forked the contract, and will
quietly miss every scenario added after it integrated. A host that points at
the globs runs the upstream suite on its next version bump.

```ts
// <your app>/tests/e2e/steps/reports-world.ts — inside your `steps` glob
import { defineReportsWorld } from '@12-apps/report-builder/e2e';

defineReportsWorld({
  reset: async (page) => { /* back to a known set of saved reports */ },
  openReports: async (page) => { /* land on the list */ },
  openInNewSession: async (browser, from) => { /* a fresh browser session */ },
  fixtures: { /* the rows and fields the scenarios name out loud */ },
});
```

```ts
// playwright.config.ts
import { reportsFeatures, reportsFeaturesRoot, reportsSteps } from '@12-apps/report-builder/e2e';

const journeys = defineBddConfig({
  features: [reportsFeatures],
  featuresRoot: reportsFeaturesRoot,   // REQUIRED — see below
  steps: [reportsSteps, 'tests/e2e/steps/**/*.ts'],
  outputDir: '.features-gen',
});
```

Two traps, both of which fail **green**:

- **`featuresRoot` is not optional.** Unset, bddgen mirrors each feature's
  `node_modules/...` path under `outputDir` and Playwright's default
  `testIgnore` drops every compiled spec. bddgen reports the features compiled
  and the project collects nothing.
- **Never write the globs as `node_modules/...` strings.** pnpm's store is
  nested and a host may install from a tarball; a glob that matches nothing
  compiles nothing and says nothing. Import the three exports instead — they
  are resolved by the package.

Running two packaged suites in one project means one `featuresRoot` covering
both; `harness/frontend/playwright.config.ts` computes it from the two exported
roots and refuses a root that would put the output back under `node_modules`.

## Porting to another repo

1. Add the workspace package (or publish it) and run `prisma:sync` against
   your schema folder (adjust `HOST_*` in
   `scripts/sync-report-builder-schema.mjs` if your layout differs).
2. Declare the package as a dependency of your schema-owning package.
3. Implement nothing: pass your Prisma client through the structural seams,
   mount `createApiReportBuilder(...).routes` (or the Hono router) behind your own
   `resolveActor`, spread the wire schemas into your MCP registry, and mount
   the React component with your tenant slug.
4. Declare your vocabulary — it is not optional any more, and it is the bulk
   of the work: a `defineCatalog` model, the permission each of its entities
   requires, your built-in reports and dashboards (or `[]`), your starters,
   your block templates, your menu sections and your tenants' IANA zone. The
   engine, the endpoints and the UI are all driven by it, and every part of it
   is checked at assembly rather than on somebody's first click.
