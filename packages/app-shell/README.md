# @12-apps/app-shell

The shell several SPAs of one product share, as an installable package: the typed
API client and its `ApiError`, the MUI theme built from a tenant's brand seed, the
session, the route error boundary, route-level code splitting that survives a
deploy, the terms/privacy consent gate — and the small backend surface that gate
needs.

```bash
pnpm add @12-apps/app-shell
```

Adoption contract, the required knobs and the sharp edges: **[ADOPTING.md](./ADOPTING.md)**.

## Why it is a package

Three SPAs cannot share nothing, so they share a private package — and a private
package is one nobody else can install. This one was 5218 LOC of exactly the things
every multi-tenant product needs in a browser, and its subsystems have been going
out to their own packages one at a time (`@12-apps/realtime`,
`@12-apps/notifications`, `@12-apps/observability-frontend`, `@12-apps/auth`). What
remained is the shell itself, and it is what all of them mount inside.

## The two halves

```ts
const shell        = createWebAppShell({ /* config */ });   // browser
const { routes }   = createApiAppShell({ /* config */ });    // backend
```

| Subpath | What is in it |
|---|---|
| `.` | Framework-free: `apiFetch` / `ApiError`, `joinApiPath` / `stripTrailingSlashes`, the WCAG brand-palette correction, pt-BR money and duration formatters, the stale-chunk recovery, the consent wire. |
| `./react` | `createWebAppShell` — the provider tower, the theme, the boundary, `lazyRoute`, the consent gate, `useDeviceDetection`. |
| `./server` | `createApiAppShell` — the consent status/accept descriptors, framework-neutral. |
| `./hono` | The forty-line adapter. `hono` is an optional peer. |
| `./vite` | `appShellOptimizeDeps()` — the dependency pre-bundling preset. Compiled, and it has to be. |

## Three things worth knowing before you read the code

**`ApiError` is load-bearing for another published package.**
`@12-apps/entitlements`' upsell channel decides whether a rejection is a plan
denial by reading `status` and `body` off one of these. The three fields are pinned
by a test for that reason.

**Nothing here reports success it cannot back.** The consent endpoint propagates a
failed write as a 500 rather than answering 204, because a 204 over a failed write
tells the user they accepted while every guard keeps refusing them. `onCrash`,
`isCurrent` and `brand.name` are required rather than defaulted, because each of
their plausible defaults fails silently in exactly the direction nobody checks.

**A colour a tenant TYPED is not a colour you can paint.** A brand hex is chosen to
look good on a sign, not to be legible as 14px text on a white card: one real seeded
tenant's `#7ED957` renders its prices at 1.76:1 against a 4.5:1 floor. The palette
keeps the hue and moves only the lightness, so the tenant recognises their colour and
cannot pick an unreadable one.

## The consent story, in one paragraph

`POST /consent/terms` could always FIX a user whose acceptance had gone stale.
Nothing could TELL them, so nobody ever called it: bumping the terms version turned
every previously-consented user into a pending one silently — still signed in,
avatar and cart intact — and the first thing they heard was a bare
`401 {"error":"Unauthorized"}` at the payment step, with a retry that could never
succeed. `GET /consent/status` is the missing half and the gate is what renders it,
which is why both halves are in one package: the two ends agreeing on a path is the
whole feature.

## Tests

```bash
pnpm test          # the package's own suites
```

The consumer proof lives in `harness/` at the repo root: a page driving the real
`createWebAppShell` against a real `createApiAppShell` mount, both installed from
packed tarballs.
