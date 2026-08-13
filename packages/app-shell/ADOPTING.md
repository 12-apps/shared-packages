# Adopting @12-apps/app-shell

This package is the **shell several SPAs of one product share** (12-18): one
library, reusable across repositories, exposing standardized surfaces. A host repo
only *points* at these surfaces — when the library updates, every host updates with
**no app changes**. The contract is the one `@12-apps/report-builder`,
`@12-apps/rbac`, `@12-apps/audit` and `@12-apps/realtime` established.

It replaces `future-pay/packages/spa-shared`, a **private** workspace package that
was the browser half of nearly every subsystem in this series and that no other app
could install.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core** | `@12-apps/app-shell` | Nothing to wire — framework-free: `apiFetch` + `ApiError`, `joinApiPath` / `stripTrailingSlashes`, the WCAG brand-palette correction, the pt-BR formatters, the stale-chunk recovery and the consent wire. Importable from a worker, a build script or the backend half. |
| **React** | `@12-apps/app-shell/react` | Call `createWebAppShell(config)` **once, at module scope**, and render `shell.Provider` around your routes. |
| **Server** | `@12-apps/app-shell/server` | Call `createApiAppShell(config)` and mount the `routes` it returns. |
| **Hono** | `@12-apps/app-shell/hono` | `app.route('/api', appShellRouter(config).router)`. A one-call mount; `hono` is an OPTIONAL peer, so importing the root, `/react` or `/server` never resolves it. |
| **Vite** | `@12-apps/app-shell/vite` | `optimizeDeps: appShellOptimizeDeps()` in your `vite.config.ts`. |
| **Prisma** | — none | This package owns **no models**. See "Why there is no Prisma partial" below. |

## What this package deliberately does NOT contain

Read this before looking for something you expected to find. Every row is a thing
that already had an owner, and copying it here would have been the second
implementation this series keeps finding.

| Looking for | It is in | Why not here |
|---|---|---|
| the session provider, `signIn` / `signOut` | `@12-apps/auth/react`'s `createWebAuth` | Already extracted, CSRF-protected POST and open-redirect defence and all. `createWebAppShell` builds one and re-exports its `useSession`. |
| the realtime client, hooks, shared worker | `@12-apps/realtime/react` | 12-16 owns the bus. The consent gate's accelerator arrives as the `consent.useSignal` seam, so this package has **no realtime dependency**. |
| the Web Push subscribe flow | `@12-apps/notifications/react` | It ships beside the preferences screen that needs it — a preference cannot reach a device that never subscribed. |
| the error-boundary MECHANISM, the DSN, the noise rules | `@12-apps/observability-frontend` | Catching a render crash is half of browser reporting. This package supplies only what a crashed page LOOKS like. |
| the inbox bell, the plan screen, the audit viewer, the impersonation banner | their own packages | One package per subsystem; the shell is the tower they all mount inside. |

## Wiring the browser half

```ts
import { QueryClient } from '@tanstack/react-query';
import { reportRouteCrash } from './observability';   // YOUR adapter — see below
import { createWebAppShell } from '@12-apps/app-shell/react';

export const shell = createWebAppShell({
  brand: { name: 'Paladira' },
  onCrash: reportRouteCrash,
  queryClient,
  consent: {},
});
```

```tsx
export function App() {
  return (
    <shell.Provider router={{ basename }}>
      <AppRoutes />
    </shell.Provider>
  );
}
```

`shell.Provider` is, innermost first: your query client (only if you gave one) →
the theme + `CssBaseline` → the session → `wrap` → the consent gate → your routes.

### `wrap` exists because the ordering is two-sided

Your own app-wide providers go in `wrap`. They must sit **below** the session
(they read it) and **above** the consent gate (the gate's `useSignal` reads your
realtime context), which is a constraint no single `children` slot can express:

```tsx
<shell.Provider
  router={{ basename }}
  wrap={(inner) => (
    <events.UserProvider>
      <ImpersonationBanner placement="fixed" />
      {inner}
    </events.UserProvider>
  )}
>
  <AppRoutes />
</shell.Provider>
```

### Wiring the consent accelerator over `@12-apps/realtime`

```ts
consent: {
  useSignal: (onSignal) => events.useUserTopics({ topics: ['consent'], onMessage: onSignal }),
}
```

One line, and it buys the case the mount-time fetch cannot cover: a tab that was
already open when the terms changed. It is an **accelerator** — the fetch remains
the thing that decides, because a best-effort bus loses events by contract and a
prompt that existed only on the stream would miss anyone whose connection dropped.

## Wiring the backend half

```ts
import { appShellRouter } from '@12-apps/app-shell/hono';

const shell = appShellRouter({
  termsVersion: TERMS_VERSION,
  consent: {
    resolveActor: async (request) => {
      const session = await getRequestSession(request.raw);
      return session?.user?.id ? { userId: session.user.id } : null;
    },
    // The SAME predicate your guards use. See rule 2.
    isCurrent: async (actor, version) => isSignedUp(await getUser(actor.userId), version),
    record: (actor, version) => recordSignup(actor.userId, version),
    onAccepted: (actor) => publishConsentChanged(actor.userId),
    cookie: { name: 'signup_terms', sign: signConsent, secure: isProduction },
  },
});

app.route('/api', shell.router);
```

## The rules, in order of how expensive they are to get wrong

1. **`onCrash` is required, and must be YOUR adapter.**
   `createRouteErrorBoundary`'s own default reports straight through
   `@12-apps/observability-frontend`, past the noise classifiers your app
   registers — so a crashed page can file an issue for a routine 404. Import the
   reporter from your own observability module, which is what loads those
   classifiers.
2. **`isCurrent` must be the predicate your guards already use.** A second
   predicate here is how the prompt comes to disagree with the thing actually
   blocking the caller: the user is told they are fine and every guarded action
   keeps refusing them, or the reverse — a prompt that can never be cleared.
3. **Let `record` throw.** The descriptor turns a failure into a 500 on purpose,
   and the browser gate trusts the status. A host that catches the error and
   resolves anyway answers 204 over a failed write: the prompt clears, the user
   believes they accepted, and every guard keeps refusing them with no signal to
   retry. That is the original dead end, one level deeper.
4. **`brand.name` is required.** A package-supplied default would put a different
   product's name on your screens. Three kinds of place cannot import it and must
   be kept in sync by hand on a rebrand: a SPA's static `index.html` `<title>`, a
   service worker's push-fallback title, and any lowercase protocol identifier
   (an MCP server id), which is deliberately not display text.
5. **Bring your own `queryClient`, or get no provider.** The shell never invents a
   cache: a host's query cache is where a 402→upsell interceptor lives, and a
   shell-created client would silently drop that interception. Omit the option and
   `QueryClientProvider` is simply not mounted.
6. **Use `lazyRoute` for every routed page, not `React.lazy`.** A deploy replaces
   the whole `assets/` directory, so an open tab asks for a chunk that no longer
   exists the moment the user clicks a nav item. `lazyRoute` reloads once onto the
   current build; a second failure inside 15s is rethrown for the boundary.
   Keep your static server's history fallback **off** asset paths, or a stale
   chunk 404s as `200 text/html` and `import()` fails in a way nothing can read.
7. **`messages` is the only place to change copy.** Defaults are pt-BR. Do not
   fork a component to retype a string.
8. **Static imports only.** This package publishes TypeScript source, except
   `./vite`. A dynamic non-literal `import()` of a subpath crashes a bundled
   server.
9. **`./vite` is the one COMPILED entry, and it has to be.** Vite bundles a
   `vite.config.ts` with esbuild while leaving bare specifiers external, so that
   import is resolved and executed by **Node** — which refuses to strip types below
   `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). It does not
   refuse while the package is a workspace sibling, so this failure appears only
   after publishing.

## Why there is no Prisma partial

The other plugins in this series own tables. This one owns none, and that is a
decision rather than an omission.

The only state the shell persists is "has this user accepted version X", and that
is a fact about the **host's own identity row** — future-pay stamps
`users.terms_accepted_at` / `users.terms_version`, and its sign-up gate, its cart,
its checkout and its whole MCP surface read the same predicate off it. A model here
would be a second, competing answer to a question the host's user table already
answers, and the two would disagree the first time a host's sign-up flow stamped
one and not the other.

So it arrives through the `isCurrent` / `record` seams instead. There is nothing to
sync, no migration to replay, and no `prisma:sync-*:check` for this package.

## Sharp edges

- **`ApiError`'s shape is a published contract.** `@12-apps/entitlements`' upsell
  channel decides whether a rejection is a plan denial by reading `status` and
  `body` off one of these, and it is already published against the private
  `@repo/spa-shared/api` this replaces. `name`, `status` and `body` are pinned by
  `src/core/__tests__/api.test.ts`; treat a change to any of them as breaking.
  Consumers should compare `error.name === 'ApiError'` rather than using
  `instanceof`, which does not survive two copies of the class in one bundle.
- **`brandRole` corrects only OVERRIDES, never the platform tokens.** A tenant's
  bright lime comes back as a deeper lime, because one tone has to serve both text
  and background; `palette.primary.light` keeps their exact hex for decoration.
  Your own tokens are design decisions already made and are painted as given.
- **The consent gate is mounted only when you pass `consent`.** Omitting it is a
  declaration that your app has no terms flow. If you have one and forget the key,
  nothing fails: the surface answers, nobody asks it, and a version bump strands
  every consented user exactly as it did before this package existed.
- **`stale: false` for an anonymous caller is deliberate.** A signed-out visitor is
  not overdue for anything; conflating the two is what made the original `401`
  unreadable.
- **The gate suppresses itself on the terms and privacy pages.** It is `persistent`
  and mounted app-wide, so on `/terms` it covered the terms — asking someone to
  accept a document while sitting on top of it, with the only two escapes being
  links that led back under it. Pass `consent.termsHref` / `privacyHref` if your
  paths differ, or the suppression matches the wrong pages.
- **`useSignal` cannot be called conditionally.** It is a hook; the gate calls it on
  every render and substitutes a no-op when you pass none. The no-op reports
  `connected: false` rather than claiming to be live.
- **The signed cookie needs YOUR secret.** `cookie.sign` has no default: the value
  is only trustworthy because it is HMAC-signed with something the browser never
  has, and a package-supplied signer would produce a token anyone could forge from
  `document.cookie`.
- **Build the shell once, at module scope.** `Provider`, `RouteErrorBoundary` and
  the session context are component types; rebuilding them per render unmounts and
  remounts everything below.
- **`termsVersion` is read per REQUEST, not at router-build time.** A constant is the
  normal case; a getter works too, so a host can move the version without rebuilding
  its router. That is what `harness/backend/src/app-shell-host.ts` does to reproduce a
  deploy's bump.
- **Normalise paths with `stripTrailingSlashes`, never `replace(/\/+$/, '')`.** The
  anchored regex is polynomial ReDoS: on a slash run followed by anything else the
  engine backtracks through every length from every position — 647 ms at 20 000
  characters, 37 s at 160 000, against 0.01 ms for the walk. It reached this package's
  first push as two HIGH CodeQL alerts, and `location.pathname` is enough of an input
  path that a link can supply one. `src/core/paths.ts` has the measurements and
  `__tests__/paths.test.ts` pins the two implementations against each other, so the
  replacement is byte-identical — slash look-alikes (`／` U+FF0F, `∕` U+2215) and
  trailing newlines included.
