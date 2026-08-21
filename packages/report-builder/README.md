# @12-apps/report-builder

Agnostic report-builder library (FUT-130): reports are **declarative JSON
specs** — authored by a UI, saved per tenant, or written by LLMs over MCP —
validated against a host-registered **field catalog**, compiled to a neutral
**query IR**, executed through a host **DataSource adapter**, and rendered to a
serializable **table model** or a `@12-apps/ui` **ChartSpec**.

```
ReportSpec (JSON) ──parse──▶ zod ──compile──▶ CompiledQuery IR ──execute──▶ rows ──render──▶ table | ChartSpec
                              ▲                     ▲
                        FieldCatalog          ReportDataSource (host, tenant-scoped)
```

Portability contract: **zero imports from apps/\***, no Prisma, no Next.js —
and, since 4.0.0, **no host DATA**. The catalog, the built-in reports, the
starters, the block templates, the entity→permission map, the adapter and the
tenant clock are all the host's and arrive as config; this package ships the
pipeline, the endpoints, the screens, the period, the document lifecycle and
one permission (`reports:manage`) for its own editor. The only workspace
dependency is `@12-apps/ui/charts` (type-only, for `ChartSpec`).

## Security model

- Specs are **data, never code** — they can only name fields the host put in
  the catalog. There is no way to express raw SQL or physical columns.
- **Tenant scoping is the adapter's job**: every `execute()` implementation
  must constrain rows to the calling tenant regardless of what the spec asks.
- Unknown entities/fields/aggregations are rejected by `compileReport` with
  actionable messages (they list what IS available) so LLM authors can
  self-correct.
- `maxRows` hard-caps output row counts (pass it on LLM-facing endpoints).

## Host integration (three steps)

```ts
import {
  defineCatalog,
  createMemoryDataSource, // or your own ReportDataSource
  runReport,
} from '@12-apps/report-builder';

// 1. Catalog: which entities/fields may be queried.
const catalog = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      fields: {
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        method: { label: 'Forma de pagamento', type: 'string', role: 'dimension' },
        totalCents: { label: 'Receita', type: 'money', role: 'measure' },
      },
    },
  },
});

// 2. Adapter: execute(query) => rows. MUST scope to the tenant.
const adapter = createMemoryDataSource({ orders: myRows });
// A real host implements ReportDataSource over its own storage —
// e.g. Prisma reads WHERE clientId = tenant, folded through
// executeCompiledQuery (exported) or translated to groupBy.

// 3. Run a spec.
const result = await runReport(
  {
    entity: 'orders',
    dimensions: [{ field: 'createdAt', timeGrain: 'day' }],
    measures: [{ field: 'totalCents' }],
    presentation: { kind: 'chart', chartType: 'area' },
  },
  { catalog, adapter, maxRows: 500 },
);

// result.render is serializable:
//   { kind: 'chart', chartSpec, rows }  → render with <SpecChart /> from @12-apps/ui/charts
//   { kind: 'table', columns, rows }    → render with any table; columns carry format hints
```

## Spec shape (v1)

```jsonc
{
  "version": 1,
  "entity": "orders",
  "dimensions": [{ "field": "createdAt", "timeGrain": "day" }], // 0–2; grains: day|week|month
  "measures": [{ "field": "totalCents", "aggregation": "sum", "alias": "revenue" }], // 1–10
  "filters": [{ "field": "method", "operator": "in", "values": ["PIX"] }], // eq|neq|in|gte|lte|between
  "sort": [{ "by": "revenue", "direction": "desc" }],
  "limit": 100,
  "presentation": { "kind": "chart", "chartType": "area" } // or { "kind": "table" }
}
```

Aggregations: `sum | avg | count | min | max | count_distinct | p50 | p90 |
p95 | ratio`, allowed per field type/role (money/number measures default to
`sum`; dimensions allow `count`/`count_distinct`). Chart presentations require
exactly one dimension (pie/donut additionally exactly one measure); everything
else is a table.

### Percentiles, ratios, suppression and formats (FUT-454)

```jsonc
{
  "entity": "order_items",
  "timeZone": "America/Sao_Paulo",   // IANA; date buckets use THIS clock
  "measures": [
    // Continuous percentile: linear interpolation (R-7), not nearest-rank.
    { "field": "prepSeconds", "aggregation": "p90", "alias": "p90",
      "minSample": 20 },             // below 20 eligible rows → suppressed
    // Ratio OF SUMS — sum(late) / sum(lines), never the mean of row ratios.
    { "field": "lateLines", "aggregation": "ratio", "denominator": "lines",
      "alias": "lateRate", "format": "percent" }
  ]
}
```

- **`minSample: N`** is enforced in the executor: below N eligible rows the
  cell holds the `SUPPRESSED` marker and the figure is never computed into the
  response, so it cannot be recovered from any other field. Eligible = rows
  with a non-null input (for `ratio`, rows carrying a denominator). Suppressed
  cells sort as nulls, so ranking cannot leak the hidden order either.
- **Divide by zero is `null`**, not `0` — rendered as the same em-dash a
  missing value gets.
- **`format`** (per measure, or declared on the catalog field) drives the
  table column, KPI tile, CSV export and API metadata alike: `duration`
  (seconds → `1h 23m` / `12m 30s`) and `percent` (a 0-1 ratio → `84%`, one
  decimal where meaningful) alongside `brl | integer | decimal | text`. Charts
  render `duration` as a plain decimal — `@12-apps/ui` has no duration axis yet.
- **`formatReportValue` / `formatKpiFigure`** are the single formatting seam;
  the SPA renderer delegates to them so screen and CSV cannot disagree.

## Conventions

- **Money is integer centavos** end to end; rendering maps `money` fields to
  the `brl` number format of `@12-apps/ui/charts`.
- **Date buckets use the tenant's IANA zone** (`spec.timeZone` →
  `CompileOptions.timeZone` → UTC), resolved onto `CompiledQuery.timeZone`.
  The last rung used to be `America/Sao_Paulo`: one country's trading day for
  every caller who named none. The mounted surface never reaches it —
  `ReportBuilderServerConfig.timeZone` is required. The conversion
  is pure `Intl`, not SQL, because the pipeline fetches rows and folds them in
  process — identical buckets on PostgreSQL, PGlite and in memory. Range
  WINDOWS stay UTC half-open `[from, toExclusive)`. `truncateDateToGrain` is
  exported (UTC when no zone is passed) so host adapters that fold rows in
  process bucket identically to the reference implementation.
- `executeCompiledQuery(rows, query)` is exported as the semantic reference:
  host adapters must match its filter/group/aggregate behavior.

## The mounted surface

The engine above is the library half. `@12-apps/report-builder/server` mounts
the ENDPOINTS and `/react` mounts the SCREENS, and both take the host's
vocabulary as required config:

```ts
const { routes } = createApiReportBuilder({
  catalog,                                   // yours
  adapter: ({ actor, window }) => …,         // yours, tenant + window scoped
  db: () => getSavedReportDb(),              // yours, through the structural seam
  timeZone: 'Europe/Lisbon',                 // yours — required, no fallback
  entityPermission: { loans: 'library:lending:read' },   // yours, every entity
  systemReports: [],                         // yours; `[]` is a complete answer
  starters: { loans: … },                    // yours; `{}` is a complete answer
  copy: PT_BR_REPORT_ENGINE_COPY,            // yours — the words a run renders
  messages: PT_BR_REPORT_SERVER_MESSAGES,    // yours — the words a refusal reads
});

const { page } = createWebReportBuilder({
  tenantSlug,
  surface: { systemReports, systemDashboards, sections, blockTemplates, timeZone },
  copy: {
    engine: PT_BR_REPORT_ENGINE_COPY,        // the same object the API takes
    blankTemplate: PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
  },
});
```

### The words are yours, and there is no default (FUT-760)

`copy` and `messages` are required, and the package ships no fallback. It used
to compile in pt-BR — the spec sentence, the column headings, the reasons a
presentation is unavailable, every refusal the API answers with — which made one
product's Portuguese the silent default for every adopter, with no field to
decline it and nothing that failed to say so.

The retired wording ships as NAMED packs (`PT_BR_REPORT_ENGINE_COPY`,
`PT_BR_REPORT_SERVER_MESSAGES`, `PT_BR_BLANK_BLOCK_TEMPLATE_COPY`), so adopting
them changes nothing on screen — the difference is that the choice is now in your
diff. Pass the SAME `ReportEngineCopy` object to both halves: a host that runs
reports server-side and renders them in the browser would otherwise be able to
print one column heading in an export and another on screen.

Translating means writing your own object, not editing the package. Note that
`copy.spec.sentence` is a TEMPLATE, not a concatenation: it receives the
assembled clauses (measures, entity, groupBy, splitBy, filters, limit) and
decides the order they are spoken in, because word order is the part that does
not survive translation.

Mounting a screen component directly, outside `createWebReportBuilder`, throws:
copy has no meaningful empty value, so a missing provider is named at the first
render rather than hidden behind blank labels.

Both throw at ASSEMBLY on a wiring mistake — an unmapped entity, a built-in that
does not compile against your catalog, a dashboard block naming a report nobody
declared, a zone this runtime cannot resolve — rather than serving a surface
that is quietly missing a piece. `ADOPTING.md` has the full contract and the
3.0.1 → 4.0.0 migration table.

A host also composes `REPORT_BUILDER_PERMISSIONS` into its own RBAC catalog: one
id, `reports:manage`, which gates this package's editor and its
`/reports/custom/**` writes. Reading is decided by the host's own
`entityPermission` tiers.
