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
| `@12-apps/jobs` | Typed background-job registry with retries, exponential backoff and cron schedules, behind a swappable driver port (BullMQ/Redis in production, inline zero-config default). `createApiJobs` wires driver resolution, the worker switch, graceful drain, the single-writer sweep lease (package-owned `SweepLease` partial + migration) and a health endpoint in one call. |
| `@12-apps/mcp` | App-agnostic MCP server core: one MCP tool per OpenAPI operation, each call proxied to the endpoint carrying the caller's bearer token. Holds zero authorization logic. |
| `@12-apps/payments-backend` | Vendor-agnostic payments: normalized charge/refund/webhook model behind per-provider adapters. |
| `@12-apps/payments-frontend` | Plug-and-play MUI components for the per-provider payment settings page. |
| `@12-apps/prisma` | The Prisma host: multi-file schema folder, the plugin migration seam, and the `PrismaClient` singleton with audit / append-only extensions. |
| `@12-apps/product-research` | Research-to-buy engine: multi-source price discovery, no-AI relevance scoring, unit-price comparison. |
| `@12-apps/product-research-ui` | Host-agnostic research screens for the engine above. |
| `@12-apps/rbac` | Role-Based Access Control: framework-free core plus optional React and server adapters. |
| `@12-apps/realtime` | Typed topic/event envelopes and a publish/subscribe bus behind a swappable driver port (Redis pub/sub in production). |
| `@12-apps/report-builder` | Reporting plugin: spec engine, host-mounted endpoints and screens, the saved-report lifecycle and the period. The catalog, the built-ins and the adapter are the host's and arrive as config. |
| `@12-apps/shift` | Headless tenant-scoped work shifts with resource bindings and audit ports. |
| `@12-apps/ui` | ~90 MUI-based components with stories and interaction tests. |
| `@12-apps/auth` | NextAuth wrapper plus an env-var admin allowlist. |
| `@12-apps/onboarding` | Guided-onboarding context and progress repository. |
| `@12-apps/shared-helpers` | Utilities: S3, caching, raw `pg` access, file handling, requests (retry/concurrency/abort), profiling, search, money, date/time. No Prisma — that lives in `@12-apps/prisma`. |
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

`@12-apps/prisma` acts as the host here, and its
`prisma/schema/schema.prisma` is **datasource + generator only** — this repo
deliberately owns no domain models. The consuming application supplies its own,
alongside the partials it adopts. Generating in this repo with no domain models
is exactly what a fresh consumer gets before adding theirs.

The host is its own package on purpose. It used to be a folder inside
`@12-apps/shared-helpers`, which made every consumer of `formatMoney` install
`@prisma/client`, PGlite and a WASM Postgres to get it — and put a database
schema inside a package whose job is generic utilities.

Three rules that came from production incidents, all gated by
`packages/prisma/package.test.ts`:

- **Migrations are copied, never symlinked.** Prisma enumerates the migrations
  folder with `lstat`, so a symlinked migration reports `isDirectory() === false`
  and is silently skipped — a green deploy that changed no schema.
- **Schema partials are copies too — nothing under `prisma/` may be a
  symlink.** `npm pack` drops symlinked entries from the tarball with no
  warning, so a consumer of the published host package would get a schema
  folder with models missing.
- **A partial's owning package must be a declared workspace dependency.**
  `turbo prune` copies only what the dependency graph reaches; an undeclared
  owner is dropped from the build context, the committed copy's source
  vanishes, and its sync script exits 1 during the image build.

## Working in this repo

```bash
pnpm install
pnpm build          # turbo
pnpm check-types
pnpm lint
pnpm test
pnpm quality:all    # complexity, flakiness, duplication, quarantine, knip
```

## Publishing

Packages are published to npm from `main` by semantic-release via OIDC trusted
publishing — no token. See `.github/workflows/ci.yml`.

They publish **public** (`publishConfig.access`), matching this repository. The
seven published while it was private are still restricted on npm; their next
release flips them, and a package's access covers every version it has, so the
versions already up there become readable too.

### Which packages a merge releases

Only the ones whose own directory changed. Each package in `PUBLISH_DIRS` is a
separate semantic-release run, and every `.releaserc.json` sets
`"extends": "semantic-release-monorepo"`, which narrows that run's commit range
to the commits touching its directory. A merge that changes `packages/payments`
releases the payments packages and nothing else; the other packages have no
releasable commits of their own, so they are not versioned, tagged, released or
published, and `npm publish` for them is a no-op the registry already has.

Without that scoping each run analysed the *whole* repo history, so any
releasable merge released all 24 packages — 24 tags, 24 GitHub releases and 24
near-identical `:tada: This PR is included in…` comments per merge, 23 of them
for packages whose files had not changed. That is what the 700-plus tags in this
repo are mostly made of.

Two consequences worth knowing:

- **Tags are `<directory>-v<version>`** (`ui-v1.17.0`), set by `--tag-format` in
  `ci.yml`. That overrides the `@12-apps/ui-v1.17.0` scheme
  semantic-release-monorepo would otherwise use — switching schemes now would
  hide every existing tag and reset all 24 packages to 1.0.0. The version string
  inside the generated release notes still reads `@12-apps/ui-v1.17.0`, because
  the plugin rewrites it there; the tag and the release itself are unaffected.
- **`prepare-publish.mjs` reads sibling versions from the git tags**, not from
  the manifests. Only a released package gets a new version written into its
  `package.json`, and versions are never committed back, so an untouched package
  sits at the `1.0.0` in the repo while the registry has it at 1.17.0. Resolving
  `workspace:*` from the manifest would publish `^1.0.0` for it.

A release announces itself on the [Releases page][releases], with a `released`
label on the merged PR and a comment naming the tag that included it. Failures
open and update a `The automated release is failing 🚨` issue.

### The first publish of a new package

OIDC cannot make a package's first publish. A Trusted Publisher is configured
from a package's settings page on npmjs.com, and that page exists only once the
package does, so a name nobody has published yet has nowhere to point the trust
at and the tokenless publish 404s ([npm/cli#8544][oidc-issue]). Every package
needs one token-authenticated publish before OIDC can take over.

CI does that bootstrap itself when the repository has an `NPM_TOKEN` secret —
a [granular access token][granular] with **read and write** on the `@12-apps`
scope. `scripts/first-publish.mjs` runs one step ahead of the tokenless publish
loop and does only what that loop cannot: it publishes the names the registry
does not have, and skips every package it does. Packages already on npm are
never touched by it, and with no secret set the step is a no-op.

Each newly published package then needs a Trusted Publisher before its **next**
release, which CI names in the step summary — npmjs.com → the package →
Settings → Trusted Publisher → GitHub Actions, repository
`12-apps/shared-packages`, workflow `ci.yml`. Once every package has one the
secret is dead weight and can be revoked; npm is
[phasing out token-based publishing][2fa] in favour of exactly this.

[releases]: https://github.com/12-apps/shared-packages/releases
[oidc-issue]: https://github.com/npm/cli/issues/8544
[granular]: https://docs.npmjs.com/creating-and-viewing-access-tokens
[2fa]: https://gh.io/npm-gat-bypass2fa-deprecation
