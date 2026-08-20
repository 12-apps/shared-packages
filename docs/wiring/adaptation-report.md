# Adaptation report: what each package needs to adopt the wiring contract

Companion to [the RFC](./rfc.md). For every package: which capabilities it
would declare (**provides**), which ports it would consume (**requires**),
and the concrete adaptation. "Manifest" always means the three additive
subpaths (`manifest`, `manifest/server`, `manifest/web`) — no existing export
changes, no runtime dependency on `@12-apps/wiring` (a devDependency for the
assignability test is the only edge).

Effort scale: **S** — manifest is a thin wrapper over existing exports (an
afternoon); **M** — one seam must be added or reshaped first; **L** — the
capability itself does not exist yet and is real design work.

## Summary

| package | http | jobs | email | notif. | mcp | perms | db | surface | areas | effort | note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| report-builder | ✔ | — | want | want | ✔ schemas | ✔ | ✔ | ✔ | ✔ | **S** | reference producer; exposes the working-copy gap |
| entity-lifecycle | ✔ | — | — | want | ✔ +annot. | ✔ | ✔ | ✔ | ✔ | **S** | already the MCP example |
| payments-backend | ✔ | ✔ (dead seam) | want | want | schemas | — | ✔ | — | — | **S/M** | blueprints exist, unconsumed |
| payments-frontend | — | — | — | — | — | — | — | ✔ | ✔ | **S** | slots stay config |
| jobs | — | n/a (runtime) | — | — | — | — | ✔ | — | — | **S** | consumer-side runtime; `BoundJob` feeds `defineJob` |
| notifications | ✔ | ✔ | n/a (owns port) | n/a (owns runtime) | — | — | ✔ | ✔ | — | **M** | re-home `EmailDriver` as `EmailPort`; accept blueprints |
| auth | ✔ | — | ✔ (`createAuthMailer`) | ✔ | — | — | — | ✔ | — | **S** | the email reference producer |
| rbac | ✔ | — | want | **want (invites)** | ✔ coverage | ✔ | ✔ | ✔ | ✔ | **M** | closes the silent-invite hole |
| realtime | ✔ | ✔ (outbox drain) | — | — | — | — | ✔ | ✔ | — | **M** | driver stays its own port |
| audit | ✔ | ✔ (retention) | — | — | schemas | ✔ | ✔ | ✔ | — | **S** | actor middleware stays explicit |
| entitlements | ✔ | — | — | want | schemas | — | — | ✔ | — | **S** | denial semantics unchanged |
| impersonation | ✔ | — | — | want | schemas | ✔ | — | ✔ (banner!) | ✔ | **M** | banner is per-document, not per-page |
| onboarding | ✔ | — | — | — | — | — | ✔ | ✔ | — | **S** | |
| storage | ✔ | — | — | — | schemas | — | — | ✔ | — | **S** | actor-scoped mounts documented in manifest |
| mcp | ✔ (oauth) | — | — | — | n/a (owns runtime) | — | ✔ | ✔ | — | **M** | accept `annotations` on `McpEndpoint` |
| product-research | ✔ | ✔ (runs) | — | ✔ (budget) | schemas | ✔ | ✔ | — | — | **M** | research.run/reenqueue as blueprints |
| product-research-ui | — | — | — | — | — | — | — | ✔ | ✔ | **S** | `ResearchApiClient` stays its port |
| shift | ✔ | ✔ (auto-close) | — | want | — | ✔ | ✔ | — | — | **M** | |
| app-shell | ✔ (consent) | — | — | — | — | — | — | n/a (IS the shell) | — | **S** | consumer-side anchor for web hosts |
| pwa | ✔ (root) | — | — | — | — | — | — | — | — | **S** | root-mount constraint in manifest |
| observability-\* | — | — | — | — | — | — | — | — | — | **S** | ports only (logger) |
| forms-core / shared-helpers / ui | — | — | — | — | — | — | — | — | — | — | libraries, not plugins — no manifest |
| state-api (shared-private) | ✔ | — | — | — | — | — | — | — | — | **S** | already `mountStateApi(config)` |

"want" = the package has a real use for the capability today and no way to
express it; the manifest is where it becomes expressible.

## Per-package detail

### report-builder — the reference producer (S)

Provides today, needing only declaration: `http` (11 descriptors from
`createApiReportBuilder` — `{ routes }` already satisfies `HttpContribution`),
`surface` (`createWebReportBuilder`), `permissions`
(`REPORT_BUILDER_PERMISSIONS` already satisfies the contribution twin), `db`
(`prisma/report-builder.prisma` + 6 migrations), `mcp` schemas (stay exported
from `./server`; the host's 8 hand-written endpoints join via the adoption's
`mcpEndpoints`), `e2e` (`./e2e`, currently unadopted by the origin host).

Adaptation:
1. `src/manifest/{index,server,web}.ts` + three export-map entries — wrappers.
2. `areas`: declare the `reports/*` splat route + the nav projection input it
   already hands hosts (`SystemReportNavEntry` is `AreaContribution`-shaped).
3. Known gaps that become *declarable* rather than fixed here: no email
   (the FUT-776 "Envio automático" stub needs `EmailContribution` + a jobs
   blueprint when it lands), no notifications (publish/share events), pt-BR
   copy baked in (unrelated to wiring; its own labels-port work), the
   undeclared `GET /roles` dependency (document as a required host endpoint in
   the manifest until it becomes config).
4. Host effect: future-pay pins `unclaimedRoutes(...) === []` — immediately
   red on the three unmounted working-copy endpoints (`PUT/POST/DELETE
   /reports/custom/:id/working-copy*`), which is the bug the contract exists
   to catch. Fixing that is three thin route files, budgeted by the MCP test
   ratchet.

### entity-lifecycle (S)

Already the closest producer: `./mcp` factory, generated `http` routes from
registrations, `page`/screens on `./react`, the partial + sync. Adaptation:
manifest wrappers; add `annotations` to the eight per-collection tools inside
`lifecycleMcpEndpoints` (all Get*/List* are `readOnly`, purge is
`destructive`) — the host's 48 policy-hint lines become overrides-only; declare
`notifications` blueprints it plausibly owns (`change-request.submitted`,
`change-request.decided`) and take an optional `NotifyPort` at
`createApiEntityLifecycle` for them. The registration model (host writes
`EntityOps` + `LifecycleEntityRegistration`) is untouched — that IS the
binding.

### payments-backend (S code, M host)

The jobs seam exists and is dead: `paymentsJobBlueprints()` +
`PAYMENTS_SWEEP_QUEUE` ship today with zero consumers, while future-pay
hand-rolls the identical `payments.reconcile-orders` (same queue, cadence,
concurrency, lease). Adaptation:
1. Dev-only assignability test: `PaymentsJobBlueprint` ⇄ `WireJobBlueprint`
   (the check the structural twins never had). No runtime import either way.
2. `manifest` + `manifest/server`: `http` wraps `mountPayments`'s handler
   table (`createPaymentsHttp` descriptors), `jobs` wraps the blueprints, `db`
   declares the partial.
3. Grow the blueprint set with the three sweeps that live host-side today —
   webhook-drain, reconcile-activations, oauth-renewal — each currently a
   host restatement of package knowledge (oauth-renewal's single-flight
   correctness is asserted in a host comment).
4. "want": an `EmailPort`-based receipt mailer and `notes`-style notification
   blueprints for the seven host-side payment notification generators
   (order-paid, over/short-payment, reversal, reconnect, billing) — Phase 2+.
5. Host effect: future-pay deletes `lib/jobs/payments.ts`'s duplicated sweep
   and binds `jobs: { deps }`; `.payments-surface.json` debt shrinks.

### payments-frontend (S)

`manifest/web` wrapping `createPaymentFlows` + the settings components;
`areas` for the admin settings page and client checkout. The
`CheckoutHostPorts` / design-system slots stay exactly what they are — the
surface config.

### jobs (S)

Not a producer — the **runtime a server host feeds the aggregate to**.
Adaptation: none required (`BoundJob` is `JobDefinition`-assignable today;
`jobs-compat.test.ts` in the wiring package pins it). Optional: re-export a
`fromWiring(jobs: readonly BoundJob[])` one-liner, and declare its own `db`
(SweepLease partial) in a manifest so the report shows it.

### notifications (M) — the port owner

The pivotal adaptation, all additive:
1. **Re-home the email seam**: keep `EmailDriver` where it is, add a type
   test that it satisfies `EmailPort`, and (optionally) re-export the type
   from the root entry so packages stop importing the server half for a
   two-line type.
2. **Accept blueprints**: `WireNotificationBlueprint` is generator-shaped;
   `createApiNotifications` takes package blueprints beside host generators
   (host maps/vetoes `category` per its taxonomy — same as today's required
   labels doctrine).
3. **Ship the NotifyPort adapter**: `wireNotifyPort(api)` mapping
   `emit({type, recipient, payload})` onto `notify` / `notifyByPermission`,
   with the "call after commit" rule enforced where the host binds it.
4. Manifest: `http` (the 9 account endpoints — note the origin host mounts
   descriptors through its own route files, which stays possible),
   `jobs` (dispatch/drain as blueprints — they are host code today in
   `lib/jobs/notifications.ts`), `db`, `surface` (Bell/Panel/Preferences —
   adopting would also retire future-pay's two hand-rolled duplicates of the
   preferences screen and push client).

### auth (S)

`createAuthMailer({ driver })` already takes an `EmailPort`-shaped driver —
declare it: `email: { createMailer: (port) => createAuthMailer({ driver: port }) }`.
Manifest also declares `http` (email-auth routers + settings router with their
mount-order constraint recorded as data), `notifications` (it is the one
package already bridging), `surface` (`SignInGate`, the email-auth screens).
The harness's `recordingDriver` becomes a `memoryEmailPort` usage.

### rbac (M) — closes the silent invite

1. Manifest: `http` (roles/permissions/team routers), `permissions` (its own
   three ids — the contribution already satisfies the twin), `surface`
   (`createWebRbac`), `db`, coverage CLI noted as tooling.
2. **The hole**: `RbacInvitesPort.invite` upserts and tells no one. Add an
   optional `notify?: NotifyPort` (and/or `mailer` via `EmailContribution`)
   to the invites endpoint context, plus a `team.invited` blueprint. A host
   that binds `NotifyPort` gets invitee notification with zero new host code;
   a host that declines does so with a written reason in the report — either
   way the silence stops being invisible.

### realtime (M)

The driver stays the package's own port (it predates and outranks this
contract). Manifest: `http` (`createApiEvents` surfaces + ticket routes),
`jobs` (the outbox drain as a blueprint — hosts that enable the outbox bind
it; future-pay currently declines the outbox deliberately, which is exactly
what a written decline is for), `db` (outbox partial), `surface`
(`createWebEvents`). The gateway remains a third process shape — out of the
contract's scope, documented in the manifest.

### audit (S)

`http` + `permissions` + `db` + `surface` wrappers. The actor-context
middleware is NOT a route and stays an explicit host mount (the harness puts
it around everything); the manifest records it as a documented requirement,
`jobs` declares the retention sweep.

### entitlements (S)

`http` (entitlements/plan/plan-request router), `surface`
(`createWebEntitlements` + the 402 interceptor contract documented), schemas
for MCP. "want": a `plan.changed` notification blueprint.

### impersonation (M)

`http` (tenant + platform routers, the write-gate as a documented middleware
requirement like audit's), `surface` — with the constraint its README states
(banner is per-document; the package refuses to start a session with no
banner host) captured as manifest documentation, `areas` for the
super-admin start dialog, `permissions`. "want": a `desk-session.started`
notification blueprint for the trail.

### onboarding / storage / pwa / app-shell / state-api (S each)

Thin manifest wrappers over `createApiOnboarding` / storage's actor-scoped
routers / the two root-mounted PWA endpoints / `appShellRouter` +
`createWebAppShell` / `mountStateApi`. app-shell doubles as the web hosts'
anchor: the consumer's `surfaces` hand back what `createWebAppShell` builds,
and the memoisation rule lives in the binder.

### mcp (M) — the annotations landing

`McpEndpoint` gains optional `annotations?: WireMcpAnnotations` (additive;
`WireMcpTool` is already a structural superset). `generateTools` carries them
into `ToolAnnotations`; host policy tables become overrides-plus-completeness
(the gate that every tool ends classified is unchanged — what changes is who
supplies the default). Its own OAuth server + prisma partial get a manifest.

### product-research / product-research-ui / shift (M / S / M)

Research: `http` + schemas + `db` + **jobs blueprints** for `research.run` /
`research.reenqueue` (host-owned today) + the `research.budget` notification
blueprint (host-owned today in `lib/notifications/research-budget.ts`).
UI: `manifest/web` wrapping the screens; `ResearchApiClient` stays the
surface config. Shift: `http`, `db`, `jobs` (`shift.auto-close`), audit ports
unchanged.

### forms-core, shared-helpers, ui, eslint-config, typescript-config, observability-\*

Libraries, not plugins: no routes, no screens-with-wiring, no models (except
observability's logger, which is a `LoggerPort` implementation hosts pass
in). **No manifest.** The contract must stay something only packages with
host-wired capabilities carry.

## Host-side adaptations

### future-pay `apps/web` (the API host)

- One `lib/wiring/host.ts`: `createWiringHost({ name: "web", kind: "server",
  ports })` with `EmailPort` (today's Resend driver), `NotifyPort`
  (`wireNotifyPort` over the notifications mount), logger, enqueue.
- Each existing `surface.ts` becomes an `adoptServer` call with the same
  config object; route files stay (coverage gates) and a new unit test pins
  `unclaimedRoutes(...)` to `[]` per package.
- `lib/jobs/index.ts` keeps host jobs; package jobs arrive via
  `assembled.jobs.map(defineJob)` — deleting the duplicated payments sweep.
- The wiring report prints at boot and is pinned by a test, so a
  `@12-apps/*` bump that adds a capability turns the Renovate PR red with a
  named reason instead of green with a silent gap.

### future-pay SPAs (web hosts)

One `createWiringHost({ kind: "web" })` per SPA; `adoptWeb` replaces the
memoised bound-surface modules (`lifecycleFor`, reports `useMemo`, …) — the
binder is the memo. Nav stays composed at one call site, now projecting
`assembled.areas` + host copy instead of hand-kept parallel files. Icons,
labels, badges stay host tables keyed by `testId`.

### the reference harness (`harness/backend`, `harness/frontend`)

Adopts package-by-package as manifests land, replacing per-package host files
where covered — `mount-surfaces.ts`'s ordering comments become the sorted
aggregate, `/__harness` controls and fixtures stay. The harness then IS the
living consumer example, tested against published tarballs, which closes the
"no reference host mounts jobs or payments" gap the exploration found.

## What this buys, in the incidents' own terms

| incident | with the contract |
|---|---|
| working-copy endpoints shipped, never mounted, client 404s | `unclaimedRoutes` pin red on the bump |
| payments blueprints shipped, no host consumes, sweep duplicated by hand | `jobs` inventory unbound → red `assemble()` until bound or declined |
| tenant invite recorded, invitee never told | rbac declares the blueprint + port; silence becomes a written decline in the report |
| `PaymentsJobBlueprint` ⇄ `JobBlueprint` drift unchecked | assignability tests compile in this repo |
| 946 lines of host MCP policy name-lists | package annotations as defaults; host table becomes overrides |
| mount order as load-bearing comments | specificity ordering derived from data |
