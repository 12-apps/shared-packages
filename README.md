# shared-packages

Reusable packages extracted from the 12-apps projects. Each one is designed to
be portable: the app-specific parts stay in the consuming application, and what
lives here is the machinery.

## Packages

| Package | What it is |
|---|---|
| `@12-apps/entitlements` | Plan/feature entitlements: layered resolution (code/plan/status/tenant), numeric quotas, per-feature revoke policy, 402-vs-403 denials. |
| `@12-apps/entity-lifecycle` | Diff-based version history with restore + retention, recycle-bin soft delete, per-item drafts and change approvals. |
| `@12-apps/forms-core` | Framework-agnostic form primitives — field validators, the `Result` type, `createServerAction`. Zero dependencies. |
| `@12-apps/jobs` | Typed background-job registry with retries, exponential backoff and cron schedules, behind a swappable driver port (BullMQ/Redis in production). |
| `@12-apps/mcp` | App-agnostic MCP server core: one MCP tool per OpenAPI operation, each call proxied to the endpoint carrying the caller's bearer token. Holds zero authorization logic. |
| `@12-apps/payments-backend` | Vendor-agnostic payments: normalized charge/refund/webhook model behind per-provider adapters. |
| `@12-apps/payments-frontend` | Plug-and-play MUI components for the per-provider payment settings page. |
| `@12-apps/product-research` | Research-to-buy engine: multi-source price discovery, no-AI relevance scoring, unit-price comparison. |
| `@12-apps/product-research-ui` | Host-agnostic research screens for the engine above. |
| `@12-apps/rbac` | Role-Based Access Control: framework-free core plus optional React and server adapters. |
| `@12-apps/realtime` | Typed topic/event envelopes and a publish/subscribe bus behind a swappable driver port (Redis pub/sub in production). |
| `@12-apps/report-builder` | Reporting plugin: spec engine plus a host-mounted backend surface (catalog, presets, policy, duck-typed Prisma adapter). |
| `@12-apps/shift` | Headless tenant-scoped work shifts with resource bindings and audit ports. |
| `@12-apps/stock-domain` | The stock-movement vocabulary — the closed value sets the reason taxonomy is built on. |
| `@12-apps/ui` | ~90 MUI-based components with stories and interaction tests. |
| `@12-apps/auth` | NextAuth wrapper plus an env-var admin allowlist. |
| `@12-apps/onboarding` | Guided-onboarding context and progress repository. |
| `@12-apps/shared-helpers` | Utilities: S3, caching, DB access, file handling, requests (retry/concurrency/abort), profiling, search, money, date/time. |
| `@12-apps/eslint-config` | Shared ESLint configs (base, Next.js, react-internal). |
| `@12-apps/typescript-config` | Shared `tsconfig` bases. |

## The Prisma seam

Packages that own persisted models keep the model file **and its migrations** in
their own folder:

```
packages/<pkg>/prisma/<pkg>.prisma        # the model partial
packages/<pkg>/prisma/migrations/         # the package's own migrations
```

A host adopts them by running that package's sync script, which copies the
partial into the host's multi-file schema folder and its migrations into the
host's migrations folder. Hosts never hand-copy models.

`@12-apps/shared-helpers` acts as the host here, and its
`prisma/schema/schema.prisma` is **datasource + generator only** — this repo
deliberately owns no domain models. The consuming application supplies its own,
alongside the partials it adopts. Generating in this repo with no domain models
is exactly what a fresh consumer gets before adding theirs.

Two rules that came from production incidents, both gated by
`packages/shared-helpers/package.test.ts`:

- **Migrations are copied, never symlinked.** Prisma enumerates the migrations
  folder with `lstat`, so a symlinked migration reports `isDirectory() === false`
  and is silently skipped — a green deploy that changed no schema.
- **A partial's owning package must be a declared workspace dependency.**
  `turbo prune` copies only what the dependency graph reaches; an undeclared
  owner is dropped from the build context, the committed symlink dangles, and
  `prisma generate` fails.

## Working in this repo

```bash
pnpm install
pnpm build          # turbo
pnpm check-types
pnpm lint
pnpm test
pnpm quality:all    # complexity, flakiness, duplication, quarantine, knip
```

Packages are published to npm from `main` by semantic-release via OIDC trusted
publishing — no token. See `.github/workflows/ci.yml`.
