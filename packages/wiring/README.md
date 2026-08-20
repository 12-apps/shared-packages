# @12-apps/wiring

The package-to-host wiring contract. A **producer** half for packages — declare
what you provide and what you require, per capability — and a **consumer** half
for hosts — adopt the declarations, bind each one against shared ports, and get
one ordered, conflict-checked, reported aggregate back.

Zero dependencies. Every capability shape is a **structural twin** of a seam a
package in this repo already ships, so adopting the contract is declaring what
already exists, not rewriting it.

## The problem

Every `@12-apps/*` package already follows the same implicit plugin shape —
`createApi*(config) → { routes }`, `createWeb*(config) → { page, … }`, a
`./hono` adapter, a Prisma partial, sometimes `./mcp` or job blueprints. But
the shape lives in TypeScript conventions and per-package ADOPTING.md files,
so:

- every host rediscovers each package's contract by reading it;
- the origin host wires ~24 packages through hand-written surface files, route
  files, nav files, icon files, badge files and policy tables;
- shapes that must stay identical across packages (`JobBlueprint` vs
  `PaymentsJobBlueprint`) are kept identical by convention, with no compile
  check anywhere;
- a version bump that adds a capability arrives silently: report-builder 5.x
  shipped three working-copy endpoints its own client calls, and the origin
  host never mounted them — the editor's autosave 404s and nothing is red;
- packages that should notify or mail cannot say so: there is no notify port
  at all, and the only email port lives inside another package's server entry.

## The model

```
        PRODUCER (the package)                CONSUMER (the host)
  ┌──────────────────────────────┐      ┌────────────────────────────────┐
  │ <pkg>/manifest               │      │ createWiringHost({name, kind,  │
  │   defineManifest({           │      │                   ports})      │
  │     name, contract: 1,       │      │                                │
  │     permissions, mcp,        │──────▶ .adoptServer({manifest,        │
  │     notifications, db, e2e,  │      │    server, bindings})          │
  │     server: ['http','jobs'], │      │ .adoptWeb({manifest, web,      │
  │     web: ['surface','areas'] │      │    bindings})                  │
  │   })                         │      │                                │
  │ <pkg>/manifest/server        │      │ .assemble() ──▶ routes, jobs,  │
  │   defineServerManifest(...)  │      │    mailers, surfaces,          │
  │ <pkg>/manifest/web           │      │    permissions, notifications, │
  │   defineWebManifest(...)     │      │    mcpEndpoints, db, areas,    │
  └──────────────────────────────┘      │    report                      │
                                        └────────────────────────────────┘
```

Three manifests per package because bundles are physics: the shared manifest
is data every runtime can hold; the server manifest carries the `createApi*`
factory and job blueprints; the web manifest carries the `createWeb*` factory.
The shared manifest **inventories** the other two, and that inventory is the
integrity mechanism: the producer refuses a runtime manifest that drifts from
it, and a host that adopts a manifest without answering an inventoried
capability gets a red `assemble()` naming the package and the capability.

Every declared capability must be **bound** or **declined with a written
reason**. Declining is legitimate — a harness with no worker declines `jobs` —
but silence is not: `assemble()` throws while anything is unanswered. That is
what turns "the bump shipped a capability the host never wired" from a silent
404 into a build failure.

## Capabilities

| kind | producer declares | consumer binds with | aggregate |
|---|---|---|---|
| `http` | `create(config) → { routes }` — the existing `createApi*` factory | `{ mountPath, config }` | `routes`, specificity-ordered, conflict-checked |
| `jobs` | namespace + dep-free blueprints (twin of `@12-apps/jobs`' `JobBlueprint`) | `{ deps }` | `jobs` — `JobDefinition` twins; `jobs.map(defineJob)` and done |
| `email` | `createMailer(port) → mailer` (the `createAuthMailer` pattern) | `{ port? }` (defaults to the host port) | `mailers[pkg]` |
| `mcp` | `WireMcpTool[]` — `McpEndpoint` plus **annotations** | collected; host-built vocabulary tools join via `mcpEndpoints` | `mcpEndpoints`, uniqueness-checked |
| `permissions` | an rbac-shaped contribution (`source`, `ids`, `permissions`, `labels`) | collected | `permissions` — feed `composePermissions` |
| `notifications` | blueprints: `type`, suggested `category`, `generate` | collected | `notifications` — feed the notifications mount |
| `db` | the Prisma partial + migrations paths | collected | `db` — feed the sync tooling |
| `surface` | `create(config) → surface` — the existing `createWeb*` factory | `{ config }` | `surfaces[pkg]`, built once (the memoisation rule, held in one place) |
| `areas` | route/nav/gate suggestions per host area | collected | `areas` — project nav from data |
| `e2e` | the journeys' entry subpath | collected | in the report |

## Ports (`@12-apps/wiring/ports`)

What a host provides once, for every package to require: `EmailPort` (the
`EmailDriver` shape, verbatim), `NotifyPort` (new — emit a typed notification
event; never throws), `LoggerPort`, `JobsEnqueuePort` (never throws),
`ClockPort`. Memory reference implementations ship for tests.

## What stays host-owned

The contract deliberately moves **no** decision that is host vocabulary today:
every user-facing sentence (pt-BR copy arrives as config, exactly as
report-builder 4.0 inverted it), guards and actor resolution, plan gates, nav
placement/labels/icons, MCP operation ids and summaries for vocabulary-driven
tools, the RBAC catalog assembly, and the database itself. The contract makes
each of those a **named, typed, refusable** argument instead of a convention.

## Example

See `src/__tests__/fixture-package.ts` for a complete producer, and
`src/__tests__/consumer.test.ts` for both host kinds. The short version:

```ts
// host (API server)
import { createWiringHost } from "@12-apps/wiring/consumer";
import { defineJob } from "@12-apps/jobs";

const host = createWiringHost({ name: "web", kind: "server", ports: { email } });
host.adoptServer({
  manifest: notesManifest,
  server: notesServerManifest,
  bindings: {
    http: { mountPath: "/api/admin/:tenantSlug", config: { store } },
    jobs: { deps: { store, ran } },
    email: {},
  },
});
const wired = host.assemble();          // throws while anything is unanswered
wired.jobs.map((job) => defineJob(job)); // every adopted package's jobs, one line
console.log(renderWiringReport(wired.report));
```

Hosts that must keep one route file per endpoint (coverage gates read guards
out of route files) still adopt: they mount by hand and pin
`unclaimedRoutes(wired.routes, claimedKeys)` to `[]` in a unit test, which is
the test that would have caught the working-copy 404.

## Status

Proposal-stage: `"private": true` and not in `release-packages.txt`, so
nothing publishes on merge. Accepting the proposal means dropping `private`
and adding `packages/wiring` to the release list (it has no dependencies, so
it slots in first). The RFC and the per-package adaptation report live in
`docs/wiring/`.
