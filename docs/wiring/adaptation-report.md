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
| billing | ✔ | want | — | want | — | — | — (host FKs) | — | — | **shipped** | extracted from the origin host; every number, table and sentence is host config |
| payments-frontend | — | — | — | — | — | — | — | ✔ | ✔ | **shipped** | two web manifests, mirroring the backend's owner/buyer split; slots and `CheckoutHostPorts` stay surface config |
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
| mcp | ✔ (oauth) | — | — | — | n/a (owns runtime) | — | ✔ | — | — | **shipped** | manifest + `db` declaration; no `web` (no bound-surface factory); `annotations` on `McpEndpoint` still open |
| product-research | ✔ | ✔ (runs) | — | ✔ (budget) | schemas | ✔ | ✔ | — | — | **M** | research.run/reenqueue as blueprints |
| product-research-ui | — | — | — | — | — | — | — | ✔ | ✔ | **shipped** | `createWebResearch` binds the port; copy stays a per-render prop |
| shift | ✔ | ✔ (auto-close) | — | want | — | ✔ | ✔ | — | — | **M** | |
| app-shell | ✔ (consent) | — | — | — | — | — | — | n/a (IS the shell) | — | **shipped** | consumer-side anchor for web hosts; the cookie crosses on the raw answer |
| pwa | ✔ (root) | — | — | — | — | — | — | — | — | **shipped** | root-mount constraint recorded in the manifest, `Vary` shared with `./hono` |
| observability-\* | — | — | — | — | — | — | — | — | — | **S** | ports only (logger) |
| forms-core / shared-helpers / ui | — | — | — | — | — | — | — | — | — | — | libraries, not plugins — no manifest |

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
4. Host effect: the origin host pins `unclaimedRoutes(...) === []` — immediately
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
`PAYMENTS_SWEEP_QUEUE` ship today with zero consumers, while the origin host
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
5. Host effect: the origin host deletes `lib/jobs/payments.ts`'s duplicated sweep
   and binds `jobs: { deps }`; `.payments-surface.json` debt shrinks.

### billing (shipped)

`http` (the card-on-file surface: read the cards, open a vault session, finish
one, remove them all), `observability` under `billing`. Declares **no** `db`
contribution and will not until subscriptions, cycles and stored instruments
lose their foreign keys into the adopting host's account table — a package
partial cannot declare a relation into a table it does not own, which is the
same graduation rule every other model set is held to.

The interesting half is what the package refused to take. Period arithmetic,
status ageing, the retry ladder and the billing-to-entitlements mapping were
all classified `app-specific` in the origin host's payment-surface ledger, each
with a written reason amounting to *this is our commercial policy*. Every one
of those reasons survives extraction intact, because the policy is now a
required argument: the two lifecycle windows, the ladder and its cap, the two
gate tables, and every sentence the HTTP surface can answer with. A
`BillingConfigError` at construction is what replaces the defaults — the same
posture `assertReportBuilderConfig` takes toward host vocabulary.

"want": `jobs` blueprints for the collection tick and the charge attempt, which
stay in the host today because their handlers reach its notification copy and
its cycle repository; and a `subscription.charge_failed` notification
blueprint, which needs the notify port before it can carry anything but a
type.

### payments-frontend (shipped)

TWO web manifests, mirroring the backend's privilege split for the same
reason: the OWNER's provider-settings screen mounts in an admin SPA behind
that host's admin session, and the SHOPPER's checkout mounts in a storefront
SPA for an anonymous visitor. One manifest would hand a host one surface
config for two mounts in two applications, and oblige the storefront to build
the owner's settings transport in order to render a checkout.

- `@12-apps/payments-frontend` — `surface` is `createWebPaymentsSettings`
  (new, and the merchant twin of `createPaymentFlows`: it binds the
  `PaymentsSettingsClient` and nothing else), `areas` puts it at
  `config/payments` in `admin` with a nav row.
- `@12-apps/payments-checkout-ui` — `surface` IS `createPaymentFlows`,
  unchanged; `areas` routes `checkout` in `client` with **no** nav row, since
  a checkout is reached from a cart and a menu entry pointing at it is a link
  to an empty basket.

The `CheckoutHostPorts` / design-system slots stay exactly what they are — the
surface config, which is precisely the shape `create(config)` carries. So do
the copy packs, and those stay PER-RENDER props rather than factory config:
copy follows the reader's locale, and binding a pack at factory time pins the
surface to whichever language was in effect when the host built it.

The manifests are UNTYPED pure data, and their compliance suite lives in
`packages/wiring/src/__tests__/payments-frontend-manifest.test.ts` — the
portability ruleset (`payments/no-host-imports`) allows this package no
`@12-apps/wiring` import at all, type-only included, exactly as for the
backend.

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
   adopting would also retire the origin host's two hand-rolled duplicates of the
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
it; the origin host currently declines the outbox deliberately, which is exactly
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

### onboarding / storage / pwa / app-shell (shipped)

Thin manifest wrappers over `createApiOnboarding` / storage's actor-scoped
routers / the two root-mounted PWA endpoints / `createApiAppShell`. Two of them
needed a decision written down rather than a wrapper:

- **pwa** — the ROOT-MOUNT constraint. `PwaRoute.path` is absolute from the
  origin root, not relative to a mount, because a service worker's scope is
  its own directory and the manifest is linked from a static `index.html`
  that cannot know a prefix. The consumer joins `mountPath + path`, so the
  only correct binding is `mountPath: '/'`; a host that serves the manifest
  elsewhere says so through `config.manifestPath`, never through the mount.
  The manifest exports `PWA_MOUNT_PATH` so an adopter names the constraint
  instead of retyping a string. The wire view is also the adapter for `Vary`
  and for the forwarded-host derivation — both moved to `server/request.ts`
  and shared with `./hono`, because a second copy is exactly where a
  forgotten `Vary` (one cacheable manifest URL serving every tenant) would
  get in.
- **app-shell** — the consent cookie crosses on the contract's RAW answer.
  `AppShellResponse` carries cookie instructions because a framework-neutral
  handler has no response object to set one on, and leaving that to each host
  is what made "the acceptance succeeded but the cookie never left" a
  per-adapter bug. It declares **no** `web` half, deliberately:
  `createWebAppShell` would satisfy the contribution structurally, but it IS
  the shell other surfaces are mounted inside rather than cargo a host
  places, so the three SPAs keep calling it directly at their root.

### mcp (manifest shipped; the annotations landing still open)

**Shipped.** The OAuth server and the Prisma partial now have a manifest.
The `db` declaration is the consequential half: this package ships
`prisma/mcp.prisma` plus a migration, and until now nothing said so in a form
a host assembler could read — so the partial rode the assembler's STRUCTURAL
discovery fallback, and three tables reached somebody's database because a
`readdir` found them rather than because the package declared them. That is
the anti-pattern `@12-apps/notifications`' manifest was written to close for
its four models. `composed`, not `isolated`: the models carry no relation as
shipped, but adopters are invited to add the FK onto `user_id` (the origin
host's is `ON DELETE CASCADE`), and a package cannot declare isolation for
models its hosts relate into their own account tables.

`manifest/server` wraps `createApiMcpOauth` in a wire view answering the
contract's RAW half — every endpoint here answers a 302 whose `Location` is
the payload, a form-encoded RFC 6749 body, a JWKS with its own cache header
or an RFC 8414/9728 document, none of which `{ status, body }` can express.
Every route is `public`, because these six ARE the authentication and a host
gate in front of them would demand a token from the endpoint that issues
tokens. The mount is the origin root: `.well-known/*` cannot live under a
prefix.

Written narrowings: no `mcp` capability (this package IS the runtime and
advertises no tools of its own), no `permissions` (authorization is the OAuth
scope set plus bearer passthrough — there is no id to contribute), no `env`
(the signing-key variable NAMES are exported for a host to read `process.env`
with; the package reads nothing), no `jobs` (codes are stateless signed
blobs, so there is nothing to sweep), and no `web` — `./react` exports
components a host mounts with its own props, not a `createWeb*` factory, and
inventing one to have something to declare would freeze a props table three
hosts pass differently.

**Still open.** `McpEndpoint` does NOT yet carry
`annotations?: WireMcpAnnotations`. `WireMcpTool` is already a structural
superset (annotations are optional), so the manifest above needed nothing
from it — but the 48 package-declared lifecycle tools still cost 48
hand-written host lines. That landing is unchanged work: add the field,
carry it through `generateTools` into `ToolAnnotations`, and host policy
tables become overrides-plus-completeness.

### product-research / product-research-ui / shift (M / S / M)

Research: `http` + schemas + `db` + **jobs blueprints** for `research.run` /
`research.reenqueue` (host-owned today) + the `research.budget` notification
blueprint (host-owned today in `lib/notifications/research-budget.ts`).
UI (**shipped**): `manifest/web` wrapping the screens through a new
`createWebResearch`, which binds the two things a host was threading into
each screen by hand — the `ResearchApiClient` port and the realtime
`runChannel`, whose own contract requires a referentially stable value
because the run screen uses it as a hook. `messages` deliberately stays a
per-render prop: those strings follow the reader's locale, and binding the
pack at factory time would pin the screens to whichever language was in
effect at mount. `areas` suggests the two admin routes, deep-linkable run
included, with no gates — `research:read` / `research:write` belong to the
sibling manifest that enforces them. Shift: `http`, `db`, `jobs`
(`shift.auto-close`), audit ports unchanged.

### forms-core, shared-helpers, ui, eslint-config, typescript-config, observability-\*

Libraries, not plugins: no routes, no screens-with-wiring, no models (except
observability's logger, which is a `LoggerPort` implementation hosts pass
in). **No manifest.** The contract must stay something only packages with
host-wired capabilities carry.

## Host-side adaptations

### The origin host's API server

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

### The origin host's SPAs (web hosts)

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
