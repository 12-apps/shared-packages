# Adopting the payments platform

How a host application wires `@12-apps/payments-backend` + `@12-apps/payments-frontend`
— this repo first, any other repo second.

## 1. Database

1. `pnpm --filter @12-apps/payments-backend prisma:sync` — creates SYMLINKS in
   the host's `prisma/schema/` and `prisma/migrations/` folders pointing at
   the package-owned `payments.prisma` and migration folders (commit the
   symlinks; `prisma:sync:check` is the CI drift gate). No payment model or
   migration is ever copied into the application.
2. Declare `@12-apps/payments-backend` as a dependency of the package that OWNS
   the schema folder (here `@12-apps/shared-helpers`). The links are invisible to
   the dependency graph, so without this any tool that copies only the packages
   the graph reaches — `turbo prune`, which is how the Docker images are built —
   leaves the links dangling and `prisma generate` dies with
   `ENOENT ... prisma/schema/payments.prisma`. That is a build-time relationship,
   so `devDependencies` is enough. `package.test.ts` in the host package enforces
   it for every symlinked partial.
3. `prisma migrate deploy` and `prisma generate` work unchanged — Prisma
   reads straight through the links.

The three tables are FK-free and merchant-scoped, so no host schema changes
are needed — in another repo, point the link script's HOST_* paths at that
repo's prisma folders (Windows checkouts need symlink support enabled).

## 2. Backend wiring

Instantiate once (see README quick start): registry → `ProviderConfigStore`
(Prisma adapter + the host's cipher — this repo's AES-256-GCM
field-encryption codec — plus `prisma.$transaction`, which is REQUIRED so
the active-provider switch is atomic) → settings service → gateway → `createPaymentsHttp`.

Two constructor arguments are security-critical:

- **`resolveChargeRequest` (required)** — the browser posts a draft with a
  method, payment instruments and an opaque `orderRef`; it has no way to
  send `amount` or `reference`. Your resolver looks the order up
  server-side and returns the authoritative `ChargeInput`. Throw from it to
  reject the charge. This is the single control that stops a tampered
  client from underpaying.
- **`allowStubMode` (default false)** — leave it off everywhere except
  local dev and demo tenants. Take it from `resolveStubMode(process.env)`,
  which requires an explicit `PAYMENTS_STUB=1` and throws outright in
  `NODE_ENV=production`; never infer it from whether some other credential
  happens to be set. Pass the SAME answer to `createSettingsService`,
  `credentialStoreFrom`, the activation context and — through the settings
  service — the verify probe: the write path alone does not govern the rows
  already in the table, and in stub mode a webhook delivery authenticates
  with no signature at all and a probe passes without asking the acquirer
  anything. Even when on it applies only to SANDBOX configs; PRODUCTION can
  never run stub charges.

> **Upgrading from a version before FUT-696**: the stored `stub` column is no
> longer believed on its own — every read now also requires the deployment's
> answer. That option is optional and defaults to OFF, so a host that passes
> it to only SOME seams still COMPILES and then disagrees with itself at
> runtime, in both directions: the seams left unanswered stop honouring stub
> rows (stub-seeded e2e fixtures start making real acquirer calls), while a
> write path still carrying the old inference keeps MINTING stub rows for the
> next deployment to find. Resolve it once at startup, thread that one value
> everywhere, and run any stub-mode e2e suite before shipping the bump.

Mount the surface with ONE call instead of a route file per handler
(FUT-559). `mountPayments` carries the canonical layout as data and returns
`{ GET, POST, PUT }` for a single catch-all segment route:

```ts
// app/api/payments/[[...segments]]/route.ts (or any mount point)
import { mountPayments } from '@12-apps/payments-backend';

export const { GET, POST, PUT } = mountPayments({
  gateway: paymentsHttp, // createPaymentsHttp's result, or a lazy getter
  // Runs BEFORE any handler, with the PARSED intent ({ kind, method,
  // provider, segments, params }). Return a Response to refuse; anything
  // else is your auth context. Gate per intent — e.g. bill a plan quota
  // only on `setEnabled`, checkout intents on the buyer session, settings
  // intents on the admin session.
  requireAuth: async (request, intent) => authorize(request, intent),
  // Merchant attribution from that context — tenant checkout, admin
  // settings, or `{ kind: 'PLATFORM', id: 'platform' }` for
  // platform-charges-tenants billing.
  resolveMerchant: (auth) => ({ kind: 'TENANT', id: auth.tenantId }),
});
```

The canonical layout it serves (relative to the mount): `config`, `charges`,
`charges/:provider/:chargeId`, `webhooks/:provider`, `settings`,
`settings/priorities`, `settings/failover-policy`, `settings/guides/:provider`,
and the credential lifecycle under `settings/providers/:provider`
(`""`/`enabled`/`verify`/`oauth/begin|complete|disconnect`). Shape the mount
with:

- `prefix` — mount a SUBTREE: a catch-all at `.../settings/providers/*`
  passes `['settings', 'providers']` and the table matches the remainder
  (this repo's admin mount does exactly that).
- `exclude` — built-ins this mount must not serve. Exclude `completeOAuth`
  whenever your OAuth callback validates the CSRF `state` elsewhere: code
  spending must not be reachable as a plain authed endpoint.
- `extensions` — host-only intents (a verification-charge screen, a
  CSRF-state mint) dispatched through the same parse → auth path.
- `notFound` / `methodNotAllowed` — match your app's 404/405 house bodies.

OAuth-mode providers need three more host pieces — the CSRF state, the
callback route, and a refresh sweep over `expires_at`. See `OAUTH.md`, which
also lists the per-vendor documentation to consult. Webhooks may also stay on
their own dedicated routes (this repo keeps `/api/webhooks/**` as permanent
aliases); `handleWebhook` needs the RAW body either way.

For platform-charges-tenants billing, mount the same handlers under a
platform-admin route with `{ merchant: { kind: 'PLATFORM', id: 'platform' } }`.

Domain reactions (mark order paid, notifications, rollups, audit) live in
`onWebhookEvent` — the library stays domain-free.

### 2b. The BUYER checkout — `createPaymentFlowsBE` (FUT-740)

`mountPayments` serves the merchant-ADMIN surface. The buyer's half — create a
checkout, charge an instrument, poll it, re-mint the browser key — is
`createPaymentFlowsBE`, a second table on the same dispatcher:

```ts
export const { GET, POST } = createPaymentFlowsBE({ /* config below */ });
```

| kind | verb | path | principal | merchant from |
| --- | --- | --- | --- | --- |
| `getCheckoutConfig` | GET | `/config` | PUBLIC | `resolveMerchant` |
| `listInstruments` | GET | `/cards` | BUYER | `resolveMerchant` |
| `createCheckout` | POST | `/` | BUYER | `resolveMerchant` |
| `chargeInstrument` | POST | `/charge` | BUYER | the loaded payable |
| `getStatus` | GET | `/status` | BUYER | the loaded payable |
| `refreshBrowserKey` | POST | `/refresh-key` | BUYER | the loaded payable |

`principal` is a property of the ROW: `requireAuth` runs for BUYER rows only, so
a host cannot make the SETTLING status poll anonymous by mis-branching. Rows
that carry a payable take their merchant from it, which is the one attribution a
client-supplied handle cannot forge.

**What the library now owns**, and no adopter should re-implement: per-attempt
idempotency keys, the `--` attempt reference, charge-identity fail-closed, PIX
re-tap reuse, the REDIRECT commit-on-mint rule across requests, the
superseded-code void, the captured-amount rule, the rule that a charge may only
be raised for the method the payable declares, and the ORDER in which a failure
is worded.

### The charge body, and which shape is canonical

`POST /charge` accepts TWO shapes and normalizes both (`chargeDraftOf`, exported
so you can assert what your own client's body becomes):

| canonical (nested) | accepted (what the shipped client posts) |
| --- | --- |
| `card: { token, savedCardToken, tokensByProvider }` | `token`, `tokensByProvider` |
| `saveInstrument` | `saveCard` |
| `instrumentDisplay` | `cardMeta` |
| `customer: { name, email, taxId, phone }` | `taxId` |

The nested shape is canonical — it names each field in the library's own
vocabulary — and wins field by field where both are sent. The flat shape is
accepted **permanently**, not as a deprecation shim: `@12-apps/payments-frontend`
is already running in browsers, and a tab left open across a deploy still posts
it. (The same reasoning `payableRefField` carries for `orderId`, applied to the
rest of the body.)

The flat `token` is "a fresh token, or a saved card's id for reuse" — one field
for two things. The mount asks your `instruments.resolve` first and charges a
handle the vault does not own as a fresh token, so `{ token: null, owned: false }`
must mean "never heard of it" and `{ token: null, owned: true }` must mean "the
buyer's card, not chargeable in this scope" (that one is the 409).

`customer` is merged OVER `payable.customer`, present fields winning. That is
how the CPF the card form collects reaches a provider whose `customerSchema`
requires it when your own payable row has no column to keep one in.

**What stays yours**, one port each:

- `payables` — `load` (this IS your authorization scope; return `null` for both
  "absent" and "not yours"), `create`, `view`, `stateToken`. A `Payable` is
  `{ ref, merchant, amount, method, customer, state }` and nothing else: carts,
  discounts, price snapshots and status vocabularies never enter the library.
  `load(caller, ref, context)` is also handed what the request MEANS — the
  parsed `intent`, the `method` about to be charged, the normalized `draft` and
  the `Request` itself — so a host can refuse in its own terms rather than
  smuggling any of it through `Caller`. Reading it is optional: the library
  enforces its own rules on the payable that comes back either way.
- `correlation` — `attachPending` / `recordCardOutcome` / `settle` / `expire`.
  Confirming a payment is a transaction only you can compose; the library
  decides WHEN each fires and WITH WHAT AMOUNT.
- `instruments` — vault storage. The library owns the (merchant, provider)
  scoping rule and the 409 that keeps a scope mismatch from becoming a decline.
- `browserKey` — re-mint a PUBLIC key on demand. This is the only place a
  provider NAME belongs on the checkout path, and it belongs to you.
- `copy` — every buyer-facing sentence. `defaultCheckoutCopyPtBR` ships the
  strings future-pay serves today.
- `respond` / `logger` / `mapProviderError` — optional; the response envelope
  defaults to the `{ data }` / `{ error, code, field }` shape
  `@12-apps/payments-frontend`'s client already parses.

`charges` must be a `ChargeStore & ChargeQueryStore`; both shipped stores
(`createPrismaChargeStore`, `createMemoryChargeStore`) already are. Note the two
reads on `ChargeQueryStore` answer different questions: `listPayable` is
PENDING-only (it decides whether a re-tap may reuse a code), while
`latestByReference` carries no status clause at all — the settlement poll needs
its charge back after the charge stops being pending.

If your router needs a literal file per URL — an MCP or RBAC scanner that
resolves an advertised path to a real route file cannot follow a catch-all —
mount `routes.handlers.<kind>` per file instead. Each is still a one-line mount.

## 3. Frontend wiring

- Settings page: render `<PaymentProviderSettings client={...} />` where the
  provider config screen lives today. It renders every registered provider
  from its credential schema — adding a vendor changes NOTHING here.
- Payment step only: render `<CheckoutPayment ... />` inside a
  `<PaymentsProvider>`. Inject `tokenizeCard` per the active provider's
  `tokenization` (`SDK` → load the provider's JS SDK; `PUBLIC_KEY` → encrypt
  with `config.publicKey`; `REDIRECT`/PIX flows need no tokenizer).

### The buyer checkout, mounted (`createPaymentFlows`, FUT-741)

`<CheckoutFlow>` below is still exported and still works. What it asks of a
host, though, is a prop per concern on every screen — a slot table, a
`providerConfig` it fetched itself, a `tenantSlug`, a `taxIdOnFile` — plus its
own fetch client and its own answer to "can this store charge?". Three hosts
wrote that glue, and the FUT-740 review found its criticals inside it.

So call this ONCE, at module scope, and MOUNT what comes back:

```tsx
// checkout-flows.ts — one module, one call
export const checkout = createPaymentFlows({
  useCart,                       // a HOOK: the cart as display facts
  useScope: () => ({ tenantSlug: useParams().slug }),
  ports: {
    createPayable,               // same contract as today's createOrder
    exitToCatalog: () => navigate("/menu"),
    onPaid,
    useAvailability,             // your own veto + the remedy you offer
  },
  components: myDesignSystemSlots,
});

// and in the page
<checkout.Checkout />
```

`<checkout.Checkout />` fetches `/config` itself, decides availability itself,
and renders the unavailable screen rather than a picker it cannot honour.

**Everything in the config that reads the host is a HOOK** — `useScope`,
`useCart`, `useBuyerDefaults`, `useComanda`, `ports.useAvailability`. They are
invoked in a component body, never at factory time. A value-shaped config would
freeze the slug of whichever store loaded first, and one moment's cart total,
onto every checkout the page ever renders.

**`transport`** points at the `createPaymentFlowsBE` mount. `baseUrl` defaults
to `/api/checkout` verbatim — the paths the shipped client already posts — and
`fetchImpl` is the seam a story, a harness page or a test uses to route
straight into a real mount instead of mocking our own client.

**`ports.useAvailability`** is OR'd with the chain, never swapped for it. An
empty chain means the store connected no provider; your veto means the store
CAN charge and has switched online payments off. Both must reach the
unavailable screen, and only the host knows the second one.

**Nesting individual screens.** `flows.screens.*` are all mountable on their
own — each fetches `/config` if nothing above it did. Wrap them in
`<flows.Provider>` to fetch it once for the subtree:

```tsx
<flows.Provider>
  <MyLayout>
    <flows.screens.BuyerDetails value={buyer} onChange={setBuyer} method={method} onContinue={next} />
    <flows.screens.MethodChoice value={method} onChange={setMethod} />
  </MyLayout>
</flows.Provider>
```

`flows.useCheckout()` (the flow controller) and `flows.client` (the five fetch
calls, pre-bound) are there for a host that wants neither the mount nor the
screens. The unbound free functions stay exported too.

**What the buyer is asked for** is derived from `chain[].customerSchema` ∩ the
chosen method (FUT-595) rather than hard-coded. One rule matters more than the
rest: a config whose `customerSchema` is ABSENT — an older host, a hand-written
fixture — degrades to CPF-required, never to "ask nothing". Asking nothing
produces a form the buyer completes and a 400 they meet afterwards, naming a
field there was no input for. A schema that is present and EMPTY is a different
claim (this chain genuinely needs nothing) and is honoured as one.

**The hosted handover is two screens now.** `HostedHandoff` parks the order and
THEN navigates, rendering an explicit link as the fallback — a blocked or slow
navigation used to leave the buyer on a dead page. `HostedReturn` is the return
leg, mountable at your return route. `ports.navigate` defaults to
`window.location.assign`; override it if the departure must be logged or
confirmed.

**Storybook.** Every screen and state above has a story
(`pnpm --filter @12-apps/payments-frontend dev`), each running a real
`createPaymentFlowsBE` mount in the page — so a state can be reviewed without
seeding a store or running a backend.

### The buyer checkout surface (`<CheckoutFlow>`, FUT-564)

The full three-step buyer flow — Dados (CPF + LGPD "salvar meus dados") →
Pagamento (method picker, PIX QR + polling, card form + tokenization, saved
cards, hosted-checkout redirect + return resume) → Confirmação — mounts in
one line:

```tsx
<CheckoutFlow
  cart={{ empty, totalLabel, totalItems }}   // display facts, never money math
  createOrder={(input) => ...}               // REQUIRED — see ports below
  onExitToMenu={() => ...}                   // REQUIRED — leave for your catalog
/>
```

It talks to the host-mounted `/api/checkout*` surface (`/api/checkout/status`,
`/config`, `/charge`, `/cards`, `/refresh-key`) and speaks the store's ACTIVE
provider protocol end to end — PagBank (PIX + SDK-encrypted card), Stone
(Pagar.me token), InfinitePay (hosted redirect, resumed on return) — with no
provider branching in host code.

**The ports (host domain stays in the host).** Cart, catalog, comanda and
order CREATION never enter the package; they arrive as explicit props:

| port | required | what the host does with it |
| ---- | -------- | -------------------------- |
| `cart` | yes | `{ empty, totalLabel, totalItems, discountLines? }` — read from YOUR cart; `discountLines` is your own rendered discount itemization |
| `createOrder(input)` | yes | raise the order from your cart/comanda; close over tenant + comanda scope; answer `CreateOrderResult` (`{ok:true,data:CheckoutOrder}` or a structured `CheckoutError`) |
| `onExitToMenu()` | yes | navigate to your catalog |
| `saveBuyerContact(contact)` | no | persist name/phone/CPF on "Continuar" (LGPD-gated by the flow); the WIRE rules — e.g. a blank CPF must be omitted, never sent as `""` — are yours |
| `onPaid()` | no | the order settled PAID — re-read your server-emptied cart |
| `comanda` | no | `{ scope, totalLabel, totalItems }` when settling a comanda instead of the cart |
| `taxIdOnFile` | no | `true` skips Dados (FUT-465) — the payer block offers the way back |
| `providerConfig` | no | the `GET /api/checkout/config` answer (`fetchCheckoutConfig` is exported); `null` while loading degrades safely |
| `tenantSlug` | no | scopes the saved-card list to the store being paid |
| `confirmationExtra` | no | host content on the PAID confirmation (this repo's PWA install invite) |

**The design-system contract (decision: option 3 — slot injection).** The
package ships behavior + structure and renders its pixels through a
`components` prop of primitive slots; unfilled slots fall back to raw MUI, so
the package's peers stay `@mui/material` + `@emotion/*` and NOTHING else. A
host with a design system fills the slots once; a host without one mounts the
flow bare and gets a plain, working checkout — that is what makes "used on
another app" real, since another app will not share `@12-apps/ui` either.

```tsx
<CheckoutFlow components={{ Button: MyButton, Input: MyInput }} ... />
// or, for subtrees (the admin's card-verification form does this):
<CheckoutComponentsProvider components={mySlots}>...</CheckoutComponentsProvider>
```

The slots, each with a deliberately narrow prop contract (`Checkout*Props`
types are exported; the props are the subset the checkout actually uses, so
any design system satisfies them with a thin — often identity — mapping):

| slot | contract highlights |
| ---- | ------------------- |
| `Text` | semantic `variant`/`size`/`weight`/`color`, `as`, `data-testid` |
| `Button` | `variant` solid/outline/text, `color`, `size`, `fullWidth`, `loading`, `icon`, `dataTestId` **on the button element** |
| `Input` | `label`, `error`+`helperText`, `endAdornment`, `data-testid` **on the `<input>` itself** (e2e fills it) |
| `Checkbox` | `checked`, `onChange(event, checked)`, `label` |
| `Alert` | `variant` info/warning/danger, `title`, `description`, `showIcon` |
| `LoadingState` | spinner + `message` |
| `Stepper` | `steps[{id,label}]`, `activeId`, `completed` |
| `RadioGroup` | `options[{value,label,description}]` (the saved-cards list) |
| `ActionBar` | the bottom CTA bar — host chrome (this repo's storefront passes its `StickyActionBar`) |

Layout stays raw MUI `Box` INSIDE the package (MUI is already a peer), so
slot implementations never receive layout responsibilities; test ids are
identical through every slot implementation — they are the same hooks the
storefront journeys click.

This repo's `@12-apps/ui` binding lives in `@12-apps/spa-shared/payments-ui`
(`checkoutUiComponents`); the storefront spreads it plus its `ActionBar`, and
`@12-apps/spa-shared/card` re-exports the card form pre-wired with it for the
admin's activation charge. The second-host proof is the package's own
`src/components/checkout/__tests__/second-host.test.tsx`: the full flow walks
Dados → Pagamento → card form with NO `@12-apps/ui` present (it is not even
resolvable from the package), rendering entirely through the raw-MUI default
slots.

## 4. Migrating the existing PagBank integration

1. Wrap `apps/web/lib/payments/pagbank.ts` as `pagbankProvider():
   PaymentProviderAdapter` (its results map cleanly onto `ChargeSnapshot`).
2. Register it in the host registry; migrate the `payment_integrations` rows
   into `payment_provider_configs` (same masked/preserve semantics).
3. Point order charge/webhook paths at the gateway; delete the app-local
   plumbing the gateway now owns.

## 5. Completing a live adapter

Each skeleton runs fully in stub mode and throws `liveNotImplemented` on
live credentials. Fill the `TODO(<provider>-live)` sites with `fetch` calls,
map statuses/decline codes inside the adapter, implement the real
`webhook.verify` (Stripe's HMAC check is the reference) and `parse`, point
`verifyCredentials` at a cheap authenticated endpoint, and add contract
tests beside `backend/src/__tests__/providers.test.ts` (vendor sandbox runs
as opt-in `.live.test.ts`).

## 6. Using it from another repository

Both packages are workspace-private today; to reuse elsewhere: publish them
to a private registry (the `exports` maps are ready), or vendor the
`packages/payments/` folder wholesale — it has no imports from any `apps/*`
or repo-specific package. Portability rules (enforced by review):

- backend: no database/ORM/framework in core; adapters speak `fetch`; no
  provider SDKs; Prisma coupling only via duck-typed delegates. A custom
  `ProviderConfigStore` MUST implement `setActiveProvider` atomically —
  the interface requires it and there is no sequential fallback.
- frontend: imports only TYPES from the backend package; talks only to the
  host's mounted HTTP surface; MUI + React as peers.
