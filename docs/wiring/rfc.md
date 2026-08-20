# RFC: `@12-apps/wiring` — a standard producer/consumer contract for package wiring

Status: **proposal** (package skeleton in `packages/wiring`, not yet released).
Companion document: [the per-package adaptation report](./adaptation-report.md).

## 1. Why

The estate already has a de-facto plugin standard. Twelve-plus packages ship
the same five surfaces (framework-free core, `createApi*` on `./server`, a
`./hono` adapter, `createWeb*` on `./react`, a Prisma partial with sync
scripts), and the best of them — report-builder is the reference — follow the
same doctrine: one factory per half, framework-neutral route descriptors, zero
defaults for host vocabulary, assembly-time assertion, structural DB seams,
wire schemas authored once.

What does **not** exist is anything that ties the surfaces together, and the
cost of that gap is measurable in the origin host:

- **Wiring is rediscovered per package.** Adding one packaged screen touches
  ~7 files across 2 apps (bound-surface module, routes file, nav file, icon
  file, badge file, gate pair, copy table), none of the couplings checked by a
  type — they are checked by four separate CLI gates plus drift tests. On the
  backend, every package gets a `surface.ts` plus thin per-endpoint route
  files.
- **Twin shapes are unverified.** `@12-apps/payments-backend` restates
  `@12-apps/jobs`' `JobBlueprint` field-for-field (it must stay installable
  without the jobs package) and *nothing compiles the two against each other*;
  the pinning is a comment and one string-equality test.
- **Declared capabilities go unwired silently.** Three examples found while
  preparing this RFC:
  - report-builder 5.x ships 11 route descriptors; the origin host mounts 8.
    The three working-copy endpoints (autosave / publish / discard) 404 while
    the package's own client calls them.
  - `@12-apps/jobs` shipped `defineJobModule` and payments-backend shipped
    `paymentsJobBlueprints()` — the seam built specifically because "one host
    had the reconciliation and the others silently did not" — and **zero call
    sites exist**; the origin host hand-rolls the identical sweep beside the
    unused blueprint.
  - `@12-apps/rbac`'s invites port records a `TenantInvite` row and returns
    `{ status: 'invited' }`; nobody mails the invitee, because no package has
    any channel to ask for mail or notification.
- **Requirement ports don't exist.** Email has two interfaces at different
  altitudes (`EmailDriver` inside `@12-apps/notifications/server`;
  `EmailCredentialsMailer` in auth) that compose only through a hand-written
  bridge (`createAuthMailer`). Notification emission has no port at all — the
  origin host invents a bespoke callback per mount (`notifyDispatched: …`) or
  registers generators as host code.
- **MCP contributions lose their knowledge at the boundary.** Only
  entity-lifecycle ships `McpEndpoint` factories; its 48 package-declared
  tools still cost 48 hand-written host lines in `tool-policy-hints.ts`,
  because `McpEndpoint` has no field for behavior annotations. The origin
  host's `lib/mcp` carries 946 lines of pure metadata name-lists.

## 2. What the proposal is

One zero-dependency package, `@12-apps/wiring`, with two halves and a shared
contract — the split the goal states: *a package exports using a producer
library, and the app wires with the consumer part of the same library*.

### 2.1 The contract (`@12-apps/wiring`)

One canonical shape per capability, each a **structural twin** of the seam
that already exists, so today's packages satisfy them without imports:

| capability | twin of | new field(s) |
|---|---|---|
| `WireRoute` / `HttpContribution` | report-builder's `ReportRoute` / `createApiReportBuilder` | — |
| `WireJobBlueprint` / `JobsContribution` / `BoundJob` | `@12-apps/jobs`' `JobBlueprint` / `defineJobModule` input / `JobDefinition` | — |
| `WireMcpTool` / `McpContribution` | `@12-apps/mcp`'s `McpEndpoint` | **`annotations`** (readOnly / destructive / openWorld / title) |
| `WirePermissionsContribution` | `@12-apps/rbac`'s `PermissionContribution` | — |
| `WireNotificationBlueprint` | `@12-apps/notifications`' `NotificationGenerator` | `category` widened to `string` (suggestion; the host's taxonomy decides) |
| `EmailPort` / `EmailContribution` | `EmailDriver` / the `createAuthMailer` pattern | a dependency-free home |
| `PrismaContribution` | the `packages/<pkg>/prisma/**` convention | a machine-readable declaration |
| `WebSurfaceContribution` / `AreaContribution` | the `createWeb*` convention / the harness page-registry + `ReportBuilderSurface`→nav projection | route/nav/gate rows as data |

Twins stay twins deliberately — the heavy packages keep their own local
declarations and zero runtime dependency in both directions. What changes is
that each package adds a **compile-time assignability test** with
`@12-apps/wiring` as a devDependency (`jobs-compat.test.ts` in the skeleton is
the template), so a reshape stops compiling here instead of failing in a host.

### 2.2 The producer (`@12-apps/wiring/producer`)

Three factories, because bundles are physics — a single manifest exporting the
server factory next to the React factory would drag Node into every SPA:

```
<pkg>/manifest          defineManifest(...)        data: identity, permissions,
                                                   notifications, mcp, db, e2e,
                                                   + INVENTORY of the other two
<pkg>/manifest/server   defineServerManifest(...)  http, jobs, email
<pkg>/manifest/web      defineWebManifest(...)     surface, areas
```

All three are identity functions plus assertions (the report-builder rule:
fail at assembly, in the package's own test run). The **inventory check** is
the cross-bundle integrity mechanism: the shared manifest lists which runtime
capabilities exist, both directions of drift are refused at definition time,
and the consumer refuses adoption-time silence (below).

### 2.3 The consumer (`@12-apps/wiring/consumer`)

```ts
const host = createWiringHost({ name: "web", kind: "server", ports });
host.adoptServer({ manifest, server, bindings, mcpEndpoints? });
host.adoptWeb({ manifest, web, bindings });
const wired = host.assemble();
```

- **Bindings are typed by the manifest.** Mapped conditional types recover the
  package's own config/deps types from the contribution's `create`/`handle`
  signatures, so the host writes the same typed config object it writes
  today — the contract adds no `unknown` at the host's fingertips.
- **Every declared capability must be answered**: bound, or declined with a
  written reason (`{ declined: "no worker in this harness" }` — the
  `.payments-surface.json` rule that a label is not an argument). `assemble()`
  throws while anything is unanswered. Capabilities for the other runtime are
  `out-of-scope` — the sibling host answers for them.
- **The aggregate is ordered and conflict-checked.** Route claims are
  uniqueness-checked with params equated, and registration order is derived
  (static before `:param`, a path before its own prefix) — the
  more-specific-first rule the harness's `mount-surfaces.ts` currently holds
  as a load-bearing comment becomes data. Job wire names, MCP operation ids,
  permission ids and notification types are uniqueness-checked across
  packages.
- **The wiring report** is the artifact: package × capability × status
  (`bound` / `declined` / `collected` / `out-of-scope`), printable at boot and
  pinnable in a test. Today "what did this host wire" is only answerable by
  reading the wiring code.
- **`unclaimedRoutes()`** serves hosts that must keep one route file per
  endpoint (the origin host's `mcp:coverage` / `rbac:coverage` read guards out of
  route files, so it cannot mount the aggregate directly): a unit test pins
  the uncovered set to `[]`. That test is precisely what the working-copy 404
  was missing.

### 2.4 The ports (`@12-apps/wiring/ports`)

`EmailPort` (the `EmailDriver` shape verbatim — throws on failure, caller owns
retry), `NotifyPort` (**new**: `emit(event) → { accepted, reason? }`, never
throws — the `enqueueJob` doctrine), `LoggerPort`, `JobsEnqueuePort`,
`ClockPort`, plus memory reference implementations for tests. Hosts implement
each once; packages type `requires` against them for the cost of zero
dependencies. The origin host binds `NotifyPort` to
`@12-apps/notifications`' `notify` / `notifyByPermission` behind its own
transaction-ordering rules.

## 3. What deliberately stays host-owned

Unchanged from the doctrine the packages already follow — the contract names
these as typed required arguments, it does not absorb them:

- every user-facing sentence (pt-BR copy, labels, notification wording);
- guards, actor resolution, RBAC tiers, plan gates;
- nav placement, grouping, icons, badges (packages *suggest* rows via
  `AreaContribution`; the host composes at one call site — nothing
  self-registers, per the `rbac-catalog` position);
- MCP operation ids/paths/summaries for vocabulary-driven tools;
- the database, catalogs, adapters, starters — all still config.

## 4. Migration plan

Phased, additive, one capability at a time. No package breaks: a manifest is a
new subpath beside existing exports.

**Phase 0 — land the contract.** This PR. Package in the workspace, unreleased.

**Phase 1 — the two dead seams, made alive.**
1. payments-backend: type `PaymentsJobBlueprint` against `WireJobBlueprint`
   (dev-only assignability test), ship `manifest` + `manifest/server` wrapping
   `paymentsJobBlueprints()`; the origin host deletes its hand-rolled
   `payments.reconcile-orders` and binds the blueprint.
2. report-builder: ship manifests wrapping `createApiReportBuilder` /
   `createWebReportBuilder`; the origin host adopts and pins `unclaimedRoutes` to
   `[]` — which immediately surfaces the three unmounted working-copy
   endpoints as the red test they should have been.

**Phase 2 — the ports.**
3. notifications: re-export `EmailDriver` as satisfying `EmailPort` (type
   test), ship a `wireNotifyPort(api)` adapter, accept
   `WireNotificationBlueprint[]` beside its own generators (same shape).
4. auth: `createAuthMailer` accepts `EmailPort` (it already structurally
   does); declare `email` in its manifest.
5. rbac: declare the `notes → invitee` notification blueprint and take an
   optional `NotifyPort` in the invites endpoint — closing the silent-invite
   hole.

**Phase 3 — MCP annotations.** `@12-apps/mcp` accepts `WireMcpTool` (add
optional `annotations` to `McpEndpoint` — additive), `entity-lifecycle`
annotates its eight per-collection tools, and the origin host's
`tool-policy-hints.ts` becomes overrides-only, seeded from package defaults.

**Phase 4 — the rest of the estate**, in the order the adaptation report
lists, as each package is next touched (the touch-must-fix pattern, not a big
bang). The reference harness (`harness/backend`) adopts alongside, replacing
per-package host files where the capability is covered — the harness becomes
the living consumer example, which it already almost is.

**Phase 5 — the gates adapt to packages.** Once ≥3 packages ship manifests,
the host-side gates stop scanning the filesystem and start consuming the
wiring aggregate, which is what lets a host collapse a package's surface to
ONE mount:

- **The route table spreads package routes.** `routes:generate` learns a
  second contribution form — a mount module exporting the adoption's
  assembled routes — so the generated table reads
  `export const routes: RouteTableEntry[] = [...hostRoutes, ...reportsWiring.tableEntries]`
  and one `[[...path]]/route.ts` per package replaces the per-endpoint files.
- **`mcp:coverage` and `rbac:coverage` read the aggregate.** A route that
  arrived through an adoption is covered by its manifest tool and by the
  per-descriptor guard/gate table the mount module declares (the staff/admin
  and entitlement split the per-file layout carries today must survive the
  collapse — it moves into declared data the gate reads, never into a helper
  it cannot).
- **Store/docs artifacts generate at deploy time.** `chatgpt-app-submission`
  and the docs connector stop being committed host files: the data they need
  is package-exported (the manifests), and CD generates them during
  deployment — the same trajectory that already uncommitted `openapi.json`
  and `manifest.json`.
- A `wiring:check` CLI renders the report and asserts no `unbound`; hosts
  commit the report so a bump's new capability shows in the diff.

## 5. Alternatives considered

- **A DI container / auto-discovery (scan node_modules for manifests).**
  Rejected: this estate's repeated, explicit position is that composition is
  an argument at one call site, and generated-but-committed artifacts are
  reviewed in diffs. The contract keeps adoption explicit and makes silence,
  not magic, the failure that gets refused.
- **Folder-structure convention only** (same paths for mcp/email/etc., no
  library). Cheaper, but it verifies nothing: the three incidents above all
  happened *with* conventions in place. The value is in the refusals.
- **One runtime manifest** (single `./manifest` with everything). Rejected on
  bundling physics; the split follows the `./server` / `./react` line every
  package already draws, and the inventory keeps the halves honest.
- **Extending `@12-apps/jobs`' pattern per capability** (each capability
  package owns its own module seam). That is the status quo trajectory; it
  produced N seam styles and no cross-capability report. The contract is
  deliberately the *union* of those seams, not a replacement — each capability
  package keeps owning its runtime.

## 6. Open questions

- Whether `AreaContribution` should carry icon *names* (host-mapped) or stay
  icon-free; the skeleton stays icon-free.
- Whether the wiring report should be committable JSON (like the route table)
  rather than assertable text; Phase 5 decides.
- Naming: `manifest` / `manifest/server` / `manifest/web` subpaths vs reusing
  existing `./server` entries. The skeleton assumes new subpaths so existing
  entries stay untouched.
