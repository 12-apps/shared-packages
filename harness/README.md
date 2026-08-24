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
