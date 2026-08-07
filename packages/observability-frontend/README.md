# `@12-apps/observability-frontend`

Browser error reporting on Sentry — reading what production actually said, on
the side of the wire nobody can attach a debugger to.

It has a server-side counterpart, `@12-apps/observability-backend`. They are two
packages rather than one because they share no code at all, only environment
variables — one side is `@sentry/node` plus `winston-transport`, the other is
`@sentry/react` plus React, and a single package would put a Winston transport
in every SPA's dependency tree and React in every server's:

| package | contents |
| --- | --- |
| `@12-apps/observability-backend` | a Winston transport that forwards `error`/`warn` on `@sentry/node`, a PII scrub that redacts by key at any depth, and a flush for a deliberate exit |
| `@12-apps/observability-frontend` | deferred init behind a **served** DSN on `@sentry/react`, the noise rules that keep a deploy from filing one issue per open tab, a stricter PII scrub, a route error boundary, a self-check page, and the Vite source-map upload plugin |

They are independent — either runs without the other — but they deliberately
share `SENTRY_ENVIRONMENT` and `SENTRY_RELEASE`, so a browser event and the 500
behind it land in the same environment under the same build.

Both are host-agnostic: no fetch wrapper, no router assumptions, no product
copy, no tenant vocabulary. Everything they cannot know — what a routine API
error looks like, what a crashed page should render, where the config lives —
arrives through a named seam the host fills in. See [the seams](#the-seams).

They were extracted from a working application rather than designed in the
abstract, so the reasoning below cites the failures they came from. What stays
in the consuming repo is deployment fact rather than library behaviour: which
Sentry project each app reports to, and how the upload token reaches
`docker build`.

## Entry points

| import | what it is | pulls in |
|---|---|---|
| `@12-apps/observability-frontend` | init, the pre-init buffer, context tags, `beforeSend`, `reportRouteCrash` / `reportWarning` | `@sentry/react` |
| `@12-apps/observability-frontend/react` | `createRouteErrorBoundary`, `createObservabilityPage` | + React, `react-router-dom` |
| `@12-apps/observability-frontend/self-check` | the self-check page itself | + `@12-apps/ui` |
| `@12-apps/observability-frontend/vite` | the source-map upload plugin | `@sentry/vite-plugin` (build only) |

That split is not cosmetic. The root entry is framework-free, so a worker
or a non-React host can report without React arriving through a barrel it did
not ask for. And the page is reachable only through its own subpath or the
dynamic `import()` inside the route factory — naming it in the `react` barrel
would pull a diagnostic nobody opens into every app's entry chunk.

## Wiring an app

### 1. Start it, before the first render, without awaiting it

```ts
// main.tsx
import { startObservability } from "@12-apps/observability-frontend";

void startObservability("storefront");
```

The two halves have opposite timing needs, and the single call gets both right.
Installing the global handlers (`window.onerror`, `unhandledrejection`) is
synchronous and must precede the first render, or a throw during boot is lost.
Fetching the DSN is a network round-trip and must **not** gate first paint — an
app that waits on error reporting to draw has made reporting the outage. So the
handlers go in immediately and buffer into memory; the buffer drains once the
SDK is up, or is dropped if reporting turns out to be off.

### 2. Configure the error boundary once, mount it everywhere

```tsx
// route-error-boundary.tsx
import { createRouteErrorBoundary } from "@12-apps/observability-frontend/react";

export const RouteErrorBoundary = createRouteErrorBoundary({
  fallback: ({ error, reload }) => (
    <ErrorState message={error.message} onRetry={reload} />
  ),
});
```

```tsx
// the layout, around the routed outlet
<RouteErrorBoundary resetKey={location.key}>
  <Outlet />
</RouteErrorBoundary>
```

**Why the boundary is in an observability package at all.** `window.onerror`
never sees a render crash — React catches the throw and re-throws it out of
band — so an app with global handlers but no boundary reports *nothing* for the
one failure mode that blanks the screen. They are two halves of the same
guarantee, and shipping them apart is how one ends up missing.

Two things to get right:

- **`resetKey` is the routed location.** Without it the boundary latches: error
  state is component state, and React keeps rendering the fallback until
  something clears it, so every later navigation shows the failure of a page the
  user already left. It deliberately does *not* clear on an unrelated re-render
   — that would remount a deterministically-crashing page in a loop.
- **Build it at module scope.** A boundary rebuilt per render is a new component
  type each time, so React unmounts and remounts everything below it whenever
  the parent renders.

The fallback gets `reload` and `reset`. Prefer `reload`: the usual cause of a
crashed page is a chunk that stopped existing at the last deploy, and
re-rendering the same tree cannot fetch a file that is gone.

### 3. Mount the self-check route

```tsx
import { createObservabilityPage } from "@12-apps/observability-frontend/react";

const observabilityRoute = createObservabilityPage({
  boundary: (children) => (
    <RouteErrorBoundary resetKey="self-check">{children}</RouteErrorBoundary>
  ),
});

// …then interpolate it, do not render it:
<Routes>{observabilityRoute}</Routes>
```

It returns a `<Route>` rather than exporting a component because `<Routes>`
reads its children with `createRoutesFromChildren` instead of rendering them —
a component that *returns* a `<Route>` is ignored in silence.

Pass the app's **own** boundary. The page's render-crash button only proves
something if the boundary a real page crash would hit is the one that catches
it; a boundary the package supplied would test the package.

### 4. Upload source maps at build time

```ts
// vite.config.ts
import { sentrySourcemaps } from "@12-apps/observability-frontend/vite";

plugins: [react(), sentrySourcemaps({ project: "my-frontend" })],
```

Falsy — so Vite skips it — unless `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` are both
set, which keeps local and PR builds working with no secret. It uploads and then
deletes the `.map` files, so the `dist` that reaches the web server has none.

## The self-check page

Every app that mounts it gets `/__observabilidade`: a status panel reading the
**live** SDK (initialised?, DSN with the key masked, environment, release) and
three buttons, one per reporting path.

| button | path exercised |
|---|---|
| Quebrar no render | throw during render → boundary → `reportRouteCrash` |
| Erro no handler | throw in a callback → `window.onerror` → global handler |
| Enviar warning | `reportWarning` directly, no error involved |

**Why a page and not another test.** Every part of this pipeline is unit-tested
and all of it can still be dead in production, because what breaks is never a
component — it is the PAIRING of two of them, and each half looks correct alone.
The case that motivated it: for two deploys one SPA uploaded its source maps to
a sibling's Sentry project. Builds were green, uploads succeeded, the config
endpoint answered 200, and symbolication was broken the whole time. Nothing in
CI could have said so.

Read it like this: an empty DSN in the panel means the variable never reached
the process and no button will send anything; otherwise the event should appear
within seconds, and **its stack must name a `.tsx` file and line**. A minified
frame means the maps are not paired with this release, which is the failure the
page exists to surface.

It sits outside the auth gate deliberately — the moment you most want telemetry
is when the app is broken, and "the app is broken" often includes login. That is
safe: the ingest DSN is write-only and ships in every bundle, so anyone wanting
to burn the quota can already POST to Sentry without this page. A 3s per-tab
throttle keeps a leaning finger from becoming a flood, and every event it
produces is tagged `self-check` so they filter and delete as a group.

## The seams

Five, and each exists because getting it wrong is silent.

| seam | how the host fills it | what it costs to skip |
|---|---|---|
| **app name** | `startObservability(app)`; typed as `string` here, narrow it to a union in the host | nothing, but the union is what makes a typo in `main.tsx` a compile error |
| **config endpoint** | `startObservability(app, { endpoint })`; defaults to `/api/observability-config` | — |
| **noise classifiers** | `setErrorClassifiers({ isIgnorableResponse, isStaleChunk })` | the host's routine 4xx and its own chunk-loader errors become issues |
| **crash fallback** | `createRouteErrorBoundary({ fallback, onCrash })` | — |
| **self-check boundary + lazy wrapper** | `createObservabilityPage({ boundary, lazyComponent })` | the crash button tests a boundary no real page uses |

One line that is deliberately **not** a seam: the stale-chunk **wordings**.
Chrome, Safari and Vite each phrase a dead chunk differently, and pushing that
list across the host boundary means dropping one browser's noise while reporting
another's — the same non-bug filed once per Safari user and never once per
Chrome user. Browser wording is browser knowledge, so it stays here in
`noise.ts`; the host's `isStaleChunk` **stacks on top**, for loaders that throw a
typed error instead of a recognisable message.

## It is OFF unless a DSN arrives

No DSN, no SDK, no network. Dev, CI and every test run stay offline — which is
also what stops a suite filling the issue tracker with its own deliberate
failures.

### Why the DSN is served rather than baked in

A Vite SPA is a static bundle. `import.meta.env` is inlined at build time, so a
`VITE_SENTRY_DSN` is frozen at `docker build` and a rotation becomes a rebuild —
and with a bundle served by a web server with no Node process, there is nothing
in production to read `process.env` on its behalf either.

So the browser asks `GET /api/observability-config?app=<app>` on boot. Reading
env through a *dynamic* key on the server reports the runtime configuration
rather than build-time-inlined empties. The endpoint is public and
unauthenticated on purpose: an ingest DSN is write-only and ships in a bundle
every visitor downloads, and it has to answer before a session exists, because
the errors most worth catching are on the login screen and the first paint.

The cost is that the SDK starts a round-trip late, which the synchronous
handlers plus the buffer pay for. The only window left uncovered is "the browser
could not fetch the entry bundle at all", which no in-page reporter catches.

## Noise — what must never become an issue

A reporter that shouts on every deploy is muted in its first week, and a muted
reporter still bills. All of it happens in one `beforeSend`, so it applies to
events the SDK's own instrumentation raises as well as to hand-captured ones.

1. **Stale chunks after a deploy.** Every hashed filename dies with the deploy
   that produced it, so every tab opened beforehand asks for a chunk that is
   gone. Dropped everywhere *except* at the route boundary: a host loader that
   reloads once has already swallowed the first failure, so a chunk error that
   reaches the boundary survived that recovery and is worth a look.
2. **A routine non-5xx answer.** Whatever the host's fetch layer throws for a
   `400` looks exactly like a crash. `isIgnorableResponse` is how it says
   otherwise; a 5xx still passes.
3. **Code that is not ours.** `ResizeObserver loop …`, the opaque cross-origin
   `Script error.` (no stack, no file — it groups everything unrelated under one
   heading), and stacks pointing into browser extensions.

## PII

An SPA's exposure is ordinary rather than exceptional: a checkout screen holds
the payer's name, e-mail, tax id and card fields in React state and in the DOM,
within reach of any automatic breadcrumb. A URL is evidence by itself.

1. **`scrub()`** redacts by KEY at any depth, normalising case and separators so
   `taxId` / `tax_id` / `TaxID` are one entry. By key rather than by value shape:
   a Brazilian CPF is eleven digits, and so are plenty of ids worth keeping.
   Order ids, charge ids and amounts survive on purpose — a scrub that eats them
   leaves every event undiagnosable.
2. **`scrubUrl()`** keeps the path and drops the query string and fragment. The
   path is what makes an event triageable; the query string is where tokens and
   a `?next=` e-mail end up.
3. **`sendDefaultPii: false`**, held off regardless of DSN, so request bodies,
   cookies and IPs never ride along.
4. **No Session Replay.** A replay of a checkout crash is a recording of
   someone's card. Turning it on is a separate decision that needs masking
   configured first.

`setObservabilityContext` takes a narrow object rather than a user, so the tags
stay to the set that makes an event triageable without identifying anyone. It
writes only the keys actually passed — independent components set context from
different places, and if both wrote every key the later effect would silently
overwrite the earlier one in an order neither controls.

## Tests

```bash
pnpm --filter "@12-apps/observability-*" test
```

They run on jsdom with `@sentry/react` mocked, so nothing reaches the network.
