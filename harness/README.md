# The consumer harness

Two small applications built against the **published tarballs**, never against
the workspace. `scripts/harness-install.mjs` packs every package and installs
the results here, so what these apps import is what npm would upload — the only
version of these packages a consumer ever sees.

```
harness/frontend   Vite + Playwright. A page per published surface, and per buyer flow.
harness/backend    vitest. The published backend's own assets (schema, migrations).
```

Neither is in `pnpm-workspace.yaml`. That is the point: inside a workspace every
sibling resolves whether or not its manifest says so, and every file is on disk
whether or not `files` would ship it. Both are the opposite of what a consumer
gets.

## Adding a page

Two steps, and no more:

1. write `frontend/src/pages/<slug>.tsx`;
2. add one line to `frontend/src/pages/registry.ts`.

The shell builds its nav from that list, and specs address a page by slug
(`#/<slug>`) — so nothing moves when the nav grows.

## The payments checkout pages (FUT-743)

`payments-checkout-*` is one page per BUYER FLOW, and every one of them drives
the **real** factories: `createPaymentFlows` in the browser, against a real
`createPaymentFlowsBE` mount in the same page, behind the `fetch` handed to
`transport.fetchImpl`.

That arrangement is the whole design, and it is a reaction to a specific
failure. FUT-740 shipped with all fifteen CI checks green and three criticals
live — a CARD charge that could settle a PIX payable, a `/charge` body the
shipped client never sends, and a CPF the payable structurally could not carry.
All three lived in the seam BETWEEN the two published halves, where neither
side's tests look, because each side tested its own half against a body it wrote
itself. A harness page that mocked components, or stubbed `globalThis.fetch` and
answered `{ data: … }`, would reproduce that blindness exactly.

So what is stubbed here is only what a browser genuinely cannot have:

| Stubbed | Real |
| --- | --- |
| the merchant's stored credentials | the gateway, the failover walk, the charge-identity guards |
| the provider at the other end of them | the reference convention, the buyer-field gate, the copy table |
| — | the published client's own paths, bodies and polling |

`src/payments/` holds that fixture:

- `adapter.ts` — one local, vendor-free adapter per declared chain entry. Every
  provider is named something no tokenizer recognises (`aurora`, `boreal`,
  `infinito`), so the browser takes the server-granted stub path instead of
  injecting a real acquirer's SDK. A harness page must not make a cross-origin
  call to Pagar.me in order to render.
- `store.ts` — the mount, the host's ports, and the `fetch` that routes into it.
- `host.tsx` — the glue an adopter writes: cart, ports, scope, slots.
- `probe.tsx` — **the wire probe**. What actually crossed, rendered into the
  page behind one `data-testid` per fact: the charge body's own keys, the CPF
  each provider received, the `tokensByProvider` keys, where a hosted handover
  would have taken the buyer. An assertion is then a string comparison against
  the wire rather than a screenshot of a screen.
- `foreign-slots.tsx` — a design system that is deliberately **not** MUI, for
  the second-host proof.

Only `@12-apps/payments-backend`'s ROOT entry is imported. The adapter subpaths
(`./providers/*`) reach for `node:crypto` and would not survive bundling.

## The desk-session page (`impersonation`)

`@12-apps/impersonation` is mounted the way a real host mounts it, and the split
is the point: the BANNER lives in `src/shell/harness-shell.tsx`, once, so it is
on every page in this app — the package refuses to start a session in a document
with no banner host, so a page-level mount would make that guarantee a question
of which screen you happened to be on. The page itself carries only what a host
owns: a directory row that opens the packaged dialog, a "look as" picker over
this app's own roles and people, and five probes that call HOST endpoints
standing behind the packaged write gate.

Those probes are the only way to see the gate from a browser, and there is one
per rule: an ordinary write, a money write, an allowlisted money read, an
unlisted money GET (the case where the verb lies) and a write to a borrower's own
record. `harness/backend/src/impersonation-host.ts` holds the other half — the
AES-GCM codec, the four path tables in this app's URLs, the roster, the trail
(an array, where a real adopter has an append-only table) and the branch switch a
spec flips to prove a live revocation.

## The words a HOST page has (`@12-apps/i18n`)

A package that renders a sentence declares it as a typed interface with no
defaults and ships a named pack per language; a host passes a pack and never
authors loose strings. Every page here follows that —
`PT_BR_RESEARCH_MESSAGES`, `PT_BR_RBAC_WEB_COPY`, `PT_BR_WEB_STORAGE_MESSAGES`
— because the package under test supplies the words.

**The observability page is the exception, and the reason is the interesting
one:** `@12-apps/observability-frontend` ships no copy, and correctly. It
renders nothing — it attaches to three error funnels and sends events — so
there is no screen in it to have words. That makes the words on its page the
HOST's, which is precisely the case the copy-portability doctrine is about: a
host that hardcodes them has frozen one language into a page and cannot be
told, because a single-locale app cannot tell the difference.

So `pages/observability-copy.ts` states them the way a package would, in two
locales, and `main.tsx` puts the locale in scope with one reviewable line —
`useLocale` THROWS outside a provider rather than assuming a default, which is
`@12-apps/i18n`'s own argument that "a language reached by saying nothing is
the one that ships to the wrong audience unnoticed."

Two locales rather than one, deliberately: a pack with a single entry is a
hardcoded string with extra steps, and a switch nothing exercises proves no
axis exists. `?locale=en-US` on any page hash flips it, and the spec asserts
the page came back in the other language.

Host copy that is harness SCAFFOLDING — a section heading, an error
placeholder, the label on a gated demo div — stays in English instead, by this
repo's own rule that everything a developer reads is English. The distinction
is whether a person outside this repo would ever read the string.

## The error-reporting page (`observability`)

The one page whose package the page does not mount. `startObservability` runs in
`main.tsx`, before `createRoot`, for the whole bundle — because it installs
`window.onerror` and `unhandledrejection` **synchronously**, before the config it
needs has arrived, exactly so an error thrown in that window is still caught. A
hook that ran when a route mounted would miss the errors it exists for. So this
is where a host puts it, and the page drives what is already installed.

It is OFF here and stays off: the backend answers `/api/observability-config`
with an empty DSN by default, which is no SDK and no network for every other
page in this app. That default is the package's own contract, not a harness
convenience, and `/__harness/reset` restores it.

**The ingest is real.** A DSN is a URL — `<protocol>://<key>@<host>/<projectId>`
— and the SDK POSTs to `<host>/api/<projectId>/envelope/`. Point the host at the
harness's own origin and the SDK's real transport, its real serialisation and its
real `beforeSend` pipeline all run, over Vite's proxy into
`observability-host.ts`, which parses the envelope and records what arrived.
Nothing about the package is stubbed; only the far end of the wire is ours.

That matters because of what `beforeSend` is for: **some events must NOT leave**,
and an event that was dropped and an event that was never produced are
indistinguishable from inside the page. So every noise case in
`tests/observability.spec.ts` fires a reportable error beside the dropped one —
otherwise "the ingest is empty" would also be satisfied by an SDK that never
started.

The two `setErrorClassifiers` entries in `main.tsx` are the host seam the package
refuses to guess at: what counts as a routine non-5xx answer depends on this
app's HTTP client, and what a dead chunk looks like depends on its lazy-route
strategy. A package shipping either would be filtering another product's errors.

## The price-research page (`product-research`)

Two published tarballs meeting over a socket, which is the only reason this page
exists. `@12-apps/product-research` declares the routes; `@12-apps/product-research-ui`
renders their answers; and the shapes between them travel through a store seam
typed `Promise<unknown>` so a host can answer anything at all. **There is no type
error when a host's client answers a smaller shape** — only a screen rendering
`undefined`, in production. Both packages' own suites fake the other side, so
neither can see it.

Three parts of this adoption are the HOST's and could not be otherwise:

- **the worker** (`harness/backend/src/research-worker.ts`). The start route
  persists a request, calls `enqueueRun` and answers 202 — and says why the
  accepted answer cannot carry a run id: the run is created by the background
  job, later. So every screen past the form renders rows a host produced, and a
  harness with no worker can render none of them. This one settles inline, the
  same choice the harness makes for realtime, and deliberately produces a FAILED
  source beside the OK ones (degradation is a banner, never a shorter list) and
  one offer with a NULL shipping cost (FUT-518: unstated, so the total is a
  lower bound). `researchProbes.queue = 'unavailable'` drives the other branch
  the package documents — a durable request, a 202, and no run.
- **the history listing.** `GET /research` is the one route of the seventeen the
  engine deliberately does not declare, because its query grammar is a host's own
  search-grid config. It is mounted BESIDE the package's own POST on the same
  path, sharing a path and splitting the verbs, which is the arrangement a real
  adopter has. Both go through one mapping (`research-views.ts`) — a host that
  spelled the wire shape twice is exactly what these specs make red.
- **`term_normalized`.** The package's migration backfills it once and leaves it
  "kept in sync by the host on write", using the package's exported
  `normalizeText`. The column is nullable and no write fails without it, so a
  host that forgets simply searches and matches nothing.

## Running it

```bash
node scripts/harness-install.mjs          # from the repo root: build + pack + install
cd harness/frontend
npm test                                  # bddgen, then both projects
```

**Neither step needs a build in front of it any more, and that is the point.**
Both halves of this harness used to validate stale artifacts when one was
missing, silently:

- `scripts/harness-install.mjs` packs the tarballs, and `npm pack` runs no build
  — seven packages publish `./dist` and none of them has a `prepack` hook. Run
  without a preceding `pnpm build` it shipped whatever `dist/` was on disk, so
  both harnesses tested last week's package code. `packAll` builds the workspace
  itself now (`scripts/lib/pack-workspace.mjs`).
- `vite preview` serves `dist/`, and a stale one just as happily.
  `playwright.config.ts`'s webServer command builds before it previews, so a
  bare `npx playwright test tests/shell.spec.ts` — the invocation the npm
  scripts could not cover — builds too.

`npm test` runs two Playwright projects:

- **harness** — the hand-written specs under `tests/` and `tests/e2e/`;
- **journeys** — the Gherkin under `tests/e2e/features/`, compiled by `bddgen`
  into `.features-gen` (generated, gitignored: committing it lets a scenario and
  its compiled spec drift).

A sandbox with a pinned Chromium sets `PLAYWRIGHT_CHROMIUM_EXECUTABLE` rather
than re-downloading one; CI runs `playwright install chromium` and leaves it
unset.
