# Adopting @12-apps/app-shell

This package is the **shell several SPAs of one product share** (12-18): one
library, reusable across repositories, exposing standardized surfaces. A host repo
only *points* at these surfaces — when the library updates, every host updates with
**no app changes**. The contract is the one `@12-apps/report-builder`,
`@12-apps/rbac`, `@12-apps/audit` and `@12-apps/realtime` established.

It replaces the origin host's private `packages/spa-shared` workspace package, one that
was the browser half of nearly every subsystem in this series and that no other app
could install.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core** | `@12-apps/app-shell` | Nothing to wire — framework-free: `apiFetch` + `ApiError`, `joinApiPath` / `stripTrailingSlashes`, the WCAG brand-palette correction, the pt-BR formatters, the stale-chunk recovery and the consent wire. Importable from a worker, a build script or the backend half. |
| **React** | `@12-apps/app-shell/react` | Call `createWebAppShell(config)` **once, at module scope**, and render `shell.Provider` around your routes. The error boundary is inside it — you do not mount one to make `onCrash` work. |
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
  brand: { name: 'Acme Storefront' },
  onCrash: reportRouteCrash,
  queryClient,
  consent: {},          // or `false` if your app has no terms flow — see rule 3
  messages: SHELL_COPY,  // REQUIRED — every sentence, in YOUR words. See rule 8
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

That is the whole wiring. In particular **you do not mount an error boundary** to
make `onCrash` work — `shell.Provider` carries one.

`shell.Provider` is, innermost first: your query client (only if you gave one) →
the theme + `CssBaseline` → **the route error boundary** → the session → `wrap` →
the consent gate → your routes.

### The boundary is mounted for you, and a second one is still welcome

The boundary inside `Provider` is the **last resort**: nothing under the shell can
blank the document, and every crash reaches your `onCrash`. Its `resetKey` is a
constant, which is the honest value in that position — the router is below it, so
once it has caught there is no navigation left to reset on and the fallback's
`reload` is the only retry that can help.

The *good* boundary is still yours to place, below your own chrome, so a crashed
page keeps the sidebar and the user can navigate out of it:

```tsx
function PageSlot() {
  const { key } = useLocation();          // reset on every navigation
  return (
    <shell.RouteErrorBoundary resetKey={key}>
      <Suspense fallback={<LoadingState />}>
        <Outlet />
      </Suspense>
    </shell.RouteErrorBoundary>
  );
}
```

Double-wrapping is **harmless and expected**: React hands an error to the nearest
boundary, so yours catches, the shell's never sees it, and `onCrash` fires exactly
once. There is deliberately no opt-out from the mounted one — composition already
gives a host everything an opt-out would, and a `boundary: false` knob would put
the blank page back one option away.

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

### Wiring the collapsible nav's persisted state

```ts
import {
  sidebarPanelBg,
  sidebarStorageKey,
  useCollapsedSections,
  useSidebarRail,
} from '@12-apps/app-shell/react';

// YOUR prefix, then whatever scopes the preference: a tenant-scoped shell keys
// by tenant AND operator, a console that is not keys by the operator alone.
const storeKey = sidebarStorageKey('admin-sidebar', tenantSlug, userKey);
//             = sidebarStorageKey('platform-sidebar', userKey)   // the other shell

const [collapsedSections, toggleSection] = useCollapsedSections(storeKey);
const [rail, toggleRail] = useSidebarRail(storeKey);
```

`sidebarPanelBg` comes with them: the tint that separates the panel from the
content beside it, as a function of the theme rather than a second hard-coded
grey — `<Box sx={{ bgcolor: sidebarPanelBg }}>`.

Both hooks read and write ONE `localStorage` entry per key, and both re-read it
when the key changes. Three things to know:

- **The prefix is yours.** Two shells of the same product on one origin share a
  `localStorage`, so a package-supplied prefix would make them share an entry.
- **A `null` key persists nothing** — that is what `sidebarStorageKey` returns
  for an empty segment, so a shell rendered before its session resolves does not
  write into an entry every such visitor shares. The nav still works; only the
  preference is not kept.
- **A key CHANGES more often than a tenant switcher.** The common case is a
  session resolving, which turns that `null` into a real key on the second
  render — which is why re-reading is the hooks' job rather than the caller's.
  A copy of these hooks that dropped the re-key on the grounds that its console
  had no tenant switcher showed every operator a default nav.

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
   classifiers. It is reached from the boundary `shell.Provider` mounts, so wiring
   it is all you do — this used to require a boundary of your own and no document
   said so, which made a required reporter unreachable for anyone following this
   page.
2. **`isCurrent` must be the predicate your guards already use.** A second
   predicate here is how the prompt comes to disagree with the thing actually
   blocking the caller: the user is told they are fine and every guarded action
   keeps refusing them, or the reverse — a prompt that can never be cleared.
3. **`consent` is required — pass `false` to declare you have no terms flow.**
   Silence used to mean the same as `false`, and that is the original dead end for
   a host that *does* have a terms flow and forgot the key: the surface answers,
   nobody asks it, and a version bump strands every consented user. Nothing fails
   loudly enough to find that. The server half's `isCurrent` has no default for
   this exact reason, and the two halves are now symmetric. Note the asymmetry
   that remains and is deliberate: the mounted gate is a **notification**, and the
   host's own guards are the enforcement — so a browser with no gate is
   over-blocking, never over-admitting.
4. **Let `record` throw.** The descriptor turns a failure into a 500 on purpose,
   and the browser gate trusts the status. A host that catches the error and
   resolves anyway answers 204 over a failed write: the prompt clears, the user
   believes they accepted, and every guard keeps refusing them with no signal to
   retry. That is the original dead end, one level deeper.
5. **`brand.name` is required.** A package-supplied default would put a different
   product's name on your screens. Three kinds of place cannot import it and must
   be kept in sync by hand on a rebrand: a SPA's static `index.html` `<title>`, a
   service worker's push-fallback title, and any lowercase protocol identifier
   (an MCP server id), which is deliberately not display text.
6. **Bring your own `queryClient`, or get no provider.** The shell never invents a
   cache: a host's query cache is where a 402→upsell interceptor lives, and a
   shell-created client would silently drop that interception. Omit the option and
   `QueryClientProvider` is simply not mounted.
7. **Use `lazyRoute` for every routed page, not `React.lazy`.** A deploy replaces
   the whole `assets/` directory, so an open tab asks for a chunk that no longer
   exists the moment the user clicks a nav item. `lazyRoute` reloads once onto the
   current build; a second failure inside 15s is rethrown for the boundary.
   Keep your static server's history fallback **off** asset paths, or a stale
   chunk 404s as `200 text/html` and `import()` fails in a way nothing can read.
8. **`messages` is REQUIRED, and it is the only place copy comes from.** There
   is deliberately no default any more: a shipped one was the extraction
   origin's pt-BR, spread UNDER whatever a host passed, so a host that stated
   some of the table silently inherited another product's wording for the rest.
   The interface enumerates every sentence, so your compiler names the ones you
   have not written yet. Both halves work this way — `AppShellMessages` on
   `createWebAppShell`, `AppShellServerMessages` on the server mount. Do not
   fork a component to retype a string.
9. **Static imports only.** A dynamic non-literal `import()` of a subpath
   crashes a bundled server.
10. **Every entry ships COMPILED, and `./vite` is why the rest do too.** Vite
    bundles a `vite.config.ts` with esbuild while leaving bare specifiers
    external, so that import is resolved and executed by **Node** — which
    refuses to strip types below `node_modules`
    (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). `./vite` shipped compiled
    for that reason and the others shipped as source, on the reasoning that
    application code is compiled by the consumer's bundler.

    That reasoning was wrong about who the consumers are. `./server` and
    `./hono` exist to be mounted in a Node process, and `.` is imported by
    backends too — so all three hit the same wall, and the first adopter's Node
    API server died on boot naming `src/index.ts`. Nothing caught it earlier
    because the failure is invisible twice over: pnpm LINKS a workspace sibling,
    so the realpath falls outside `node_modules` and stripping is allowed until
    the package is actually published; and every bundler-shaped check (Vite
    builds, Vitest, `tsc --noEmit`) compiles the source itself.

    If you fork this build, keep `splitting: true`. `ApiError` is compared with
    `instanceof` across `.` and `./react`, which is sound only while both resolve
    to ONE `core/api` module — compiling some entries and not others, or
    compiling all of them into self-contained bundles, gives you two classes with
    one name and every cross-boundary `instanceof` answers false.
11. **Wire `onUnexpectedError`, or the 500 rule 4 asks for reaches nobody.** The
    two are one decision: rule 4 makes a failed write a 500 so the USER gets a
    signal to retry, and this is what gives the OPERATOR one. It is optional
    because a package cannot require a host to own an error reporter, and
    `console` is not one — in every adopter so far a `console.error` reaches
    stdout and nothing else. Pass the same channel your other routes report
    through; it is handed the thrown value itself, so the reporter keeps a stack
    and something to group on. This is a regression that actually shipped: a host
    replaced its own route wrapper — which logged every unexpected throw through
    its reporter — with a one-line delegation to this surface, and the reporting
    went with the wrapper. Nothing failed, in either half.

    ```ts
    onUnexpectedError: (error, { method, path }) =>
      log.error(`[consent] ${method} ${path} threw:`, error),
    ```

## Why there is no Prisma partial

The other plugins in this series own tables. This one owns none, and that is a
decision rather than an omission.

The only state the shell persists is "has this user accepted version X", and that
is a fact about the **host's own identity row** — the origin host stamps
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
- **Tell the theme what your page's background actually is** — and prefer
  `background` over `surface` for it. `theme: { background: { light: { default:
  '#FDF8F2', paper: '#FFFFFF' } } }` both PAINTS the page and becomes the hex the
  legibility correction is measured against, so the two cannot drift. `surface`
  still wins when you pass it, for the case where they genuinely differ: your page
  comes from something the palette never sees, or you read a tenant's text against
  a card rather than the page behind it. State neither and both stay MUI's default
  (white in light, `#121212` in dark) — and a seed corrected to ≥4.5:1 against a
  background you never paint lands under the floor on the one you do.
- **`background` and `divider` are the tokens a tinted palette cannot skip.**
  Without them MUI fills its own neutrals in, so painting `body` from a
  `MuiCssBaseline` override leaves `palette.background.default` saying something
  else — and that token is what sticky headers, empty states and scroll shadows
  read in order to MATCH the page. `divider` is the same story one pixel wide: a
  cold rule between every row of an otherwise warm palette.
- **`semantics` is for a product that has DECIDED what danger looks like.** The
  defaults are MUI's anchors and are right for most hosts. Pass
  `theme: { semantics: { light: { error: '#7C2A1C' } } }` per meaning, per mode —
  the ones you omit keep the anchor. A hex you state here is used verbatim and is
  never rotated away from the brand, on the same principle as `tokens`: a decision
  already made is not re-derived.
- **A semantic is kept clear of YOUR primary, not only a tenant's.** The rotation
  reads the effective brand — the tenant's seed when there is one, your own token
  otherwise. So a platform primary sitting on the danger hue (`#D42B1F` is 4° off
  MUI's `#d32f2f`) moves danger out of its way on default-branded screens too,
  which is most of the product. Your token itself is never moved.
- **`shell.api.fetch` is bound to `shell.api.base`.** `fetch('/consent/status')`
  hits `${base}/consent/status`; pass surface-relative paths, not absolute ones.
  It is `apiFetch` + `joinApiPath`, both of which you can also import directly from
  the root entry if you want the unbound version.
- **The signed consent cookie is `Secure` by default.** `cookie.secure` defaults to
  `true`; pass `false` for a plain-HTTP dev box. The package cannot read your
  `NODE_ENV`, so this is the direction silence points — and the wrong one here is
  loud and local (the browser declines the cookie over HTTP) rather than a
  plaintext token in production.
- **The consent gate is mounted unless you pass `consent: false`.** That is a
  declaration, and it is required rather than defaulted precisely because silence
  used to be the way an app WITH a terms flow ended up ungated — nothing failed:
  the surface answered, nobody asked it, and a version bump stranded every
  consented user exactly as it did before this package existed.
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
