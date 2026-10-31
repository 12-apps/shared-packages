# Adopting the payments platform

How a host application wires `@12-apps/payments-backend` + `@12-apps/payments-frontend`
— this repo first, any other repo second.

## 1. Database

1. `pnpm --filter @12-apps/payments-backend prisma:sync -- <host schema dir>` —
   writes `payments.prisma` into the host's `prisma/schema/` folder as a
   byte-identical **COPY** of the package-owned partial, and never a symlink
   (commit the copy; `prisma:sync:check` is the CI drift gate). The migrations
   are copied too, by the host, which discovers them structurally under this
   package's `prisma/migrations`.

   **Never symlink either one.** A symlink loses three ways, all silent:
   Prisma enumerates the migrations folder with `lstat`, so a linked migration
   reports `isDirectory() === false` and is skipped — `migrate deploy` prints
   "No pending migrations to apply", exits 0, and the deploy goes green having
   changed no schema (five payments migrations sat unapplied in production
   behind that hole); `turbo prune` drops an owner the dependency graph does
   not reach and leaves the link dangling; and `npm pack` drops symlinked
   entries from the tarball, so a published schema folder simply ships without
   the model.
2. Declare `@12-apps/payments-backend` as a dependency of the package that OWNS
   the schema folder (here `@12-apps/prisma`). The copy is invisible to the
   dependency graph, so without this any tool that copies only the packages the
   graph reaches — `turbo prune`, which is how the Docker images are built —
   drops this package and the sync's `--check` exits 1 on a missing source,
   with the partial sitting right there, correct and committed. That is a
   build-time relationship, so `devDependencies` is enough. `package.test.ts`
   in the host package enforces it for every copied partial.
3. `prisma migrate deploy` and `prisma generate` work unchanged — they read
   ordinary files.

The three tables are FK-free and merchant-scoped, so no host schema changes
are needed — in another repo, pass that repo's schema folder to the sync script
(or set `PAYMENTS_HOST_SCHEMA_DIR`).

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

The provider adapters take their words as an argument —
`stripeProvider(PT_BR_STRIPE_COPY)`, and the `EN_US_*` / `PT_BR_*` pack for
every other vendor (`PT_BR_PROVIDER_COPY` / `EN_US_PROVIDER_COPY` hold them all).
Two keys are recent. Stripe's `fields` gained `secretKey`, `publishableKey`,
`webhookSecret` and `connectedAccount`, the four credential boxes' labels;
they are OPTIONAL, and a pack without them labels the boxes in English
(`Secret key (sk_...)`). InfinitePay's `fields.handlePlaceholder` is the sample
tag in the empty box (`$yourtag`, `$suatag`) and is REQUIRED, so a hand-written
`InfinitePayCopy` adds it.

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

- `setupContextFor` — the merchant facts a walkthrough cannot know, including
  **`brandName`: what YOUR platform is called**. Required, and not defaulted.
  Two guides address the platform by name mid-instruction ("… é assim que
  {brandName} confirma que a notificação veio mesmo da Stone"), and until this
  was config those sentences carried one adopter's product name to every other
  adopter's store owners. A default would have preserved exactly that.
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

Two webhook-hardening seams are the host's to wire (FUT-690):

- **Timestamp tolerance lives at intake, not in `verify`.** An adapter may
  declare `webhook.intakeFreshness` (Stripe does: five minutes on the signed
  `t=`), and `handleWebhook` refuses a stale delivery the same fail-closed
  way it refuses a bad signature. The replay sweep deliberately never applies
  the window — it re-verifies rows the inbox stored hours earlier and must
  keep succeeding — so nothing here changes replay behaviour and nothing is
  required of the host beyond mounting the normal pipeline.
- **`withPlatformWebhookSecret`** — for Connect-style providers whose
  deliveries are signed with the PLATFORM's endpoint secret. The secret is
  snapshotted into each merchant's fields at connect time, so rotating it in
  the provider dashboard silently breaks every already-connected store until
  each reconnects. Wrap the credential store (beside `withMerchantWebhookUrl`
  in the gateway wiring) so the CURRENT secret is stamped at resolve time as
  `platformWebhookSecret`; adapters accept a signature under either it or the
  merchant's own `webhookSecret`, which is what carries stores through a roll.

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
| `beginVault` | POST | `/cards/begin` | BUYER | `resolveMerchant` |
| `completeVault` | POST | `/cards/complete` | BUYER | `resolveMerchant` |
| `createCheckout` | POST | `/` | BUYER | `resolveMerchant` |
| `chargeInstrument` | POST | `/charge` | BUYER | the loaded payable |
| `getStatus` | GET | `/status` | BUYER | the loaded payable |
| `releaseCheckout` | POST | `/release` | BUYER | the loaded payable |
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
- `correlation` — `attachPending` / `recordCardOutcome` / `settle` / `expire` /
  `abandon`. Confirming a payment is a transaction only you can compose; the
  library decides WHEN each fires and WITH WHAT AMOUNT. Two of these carry a
  decision you have to make on your own rows:

  - **`recordCardOutcome` now also receives `retriable`** (FUT-1145) — the
    provider's own verdict on whether another attempt with a DIFFERENT
    instrument could succeed. A host that acts on it leaves the payable OPEN
    for a retriable decline, so the buyer's next card is charged against the
    SAME order; a host that ignores it keeps today's behaviour, which is one
    dead order per refused card in the buyer's own purchase history.
  - **`abandon` (optional)** is what `POST /release` calls (FUT-1146) once the
    provider has been asked and did NOT report a payment. Without it that row
    answers the payable's current state and changes nothing — the buyer's
    screen still recovers, but the abandoned order stays open on your side.
- `instruments` — vault storage. The library owns the (merchant, provider)
  scoping rule and the 409 that keeps a scope mismatch from becoming a decline.
- `vault` — the ownership facts for saving a card OUTSIDE a purchase
  (FUT-478): `(caller, scope) => VaultBeginInput`, where `reference` and
  `customerRef` come from your rows — derived from the buyer principal and the
  (merchant, provider) scope, never from a request body, the same rule the
  admin surface's `VaultRequestResolvers` enforces. The browser contributes
  exactly two facts to `completeVault`: the `sessionId` it confirmed and, for
  a sessionless PUBLIC_KEY provider, the encrypted card blob as `token`.
  Optional — without it, or without `instruments.save`, `/cards/begin` and
  `/cards/complete` answer 404 `Card vaulting is not enabled` (the admin
  convention) BEFORE any adapter runs, so no provider-side token is ever
  minted that you cannot store. `completeVault` answers display metadata only
  (`brand`/`last4`/`expMonth`/`expYear`), never the vault token. There is
  deliberately NO buyer-side forget: PagBank publishes no token delete, so
  removal stays a merchant/host concern on the admin table's
  `vault/:provider/forget`.
- `browserKey` — re-mint a PUBLIC key on demand. This is the only place a
  provider NAME belongs on the checkout path, and it belongs to you.
- `copy` — every buyer-facing sentence, and **required**. There is deliberately
  no default any more: a shipped one is how a host silently adopts another
  product's voice, and nothing fails to tell it so. Both halves work this way —
  `CheckoutCopy` on the backend mount, `CheckoutCopyFE` on
  `createPaymentFlows`. The types enumerate every sentence, so your compiler
  names the ones you have not written yet.
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

### Apple Pay merchant validation (`@12-apps/payments-backend/apple-pay`, FUT-3686)

Apple Pay on the web needs a server step before the sheet opens: the page
receives Apple's `validationURL`, the server calls it over mutual TLS with the
merchant identity certificate, and the page completes with the opaque session
that comes back. It is one route, and the route carries no host logic:

```ts
// e.g. app/api/checkout/apple-pay/merchant-session/route.ts
import { createApplePayMerchantValidation } from '@12-apps/payments-backend/apple-pay';

export const { POST } = createApplePayMerchantValidation({
  identity: applePayIdentities, // ApplePayIdentityPort — see below
  resolveMerchant: (request) => storeMerchantOf(request), // or a Response to refuse
});
```

The page posts `{ validationURL }`. The URL's host must be one of the gateway
hosts Apple publishes, matched exactly (`APPLE_PAY_GATEWAY_HOSTS`), over
`https`, with no userinfo or port: anything else is refused before the
certificate is loaded. The domain Apple is asked about is the browser-set
`Origin`. Success answers `{ data: <session> }`, and every refusal answers
`{ error, code }`: 400 for a bad body (including one over 4 KB), URL or
domain, 409 `APPLE_PAY_NOT_CONFIGURED`, 503 `IDENTITY_UNAVAILABLE` (the port
failed) or `IDENTITY_UNUSABLE` (the certificate is bad), 502 when Apple
refused or could not be reached, and 504 `TIMEOUT`, which also aborts the
call. The subpath is server-only (`node:https`). The types are also exported
from the root, as types only.

Two things stay the host's:

- **Set `identity.domains`.** Without it, a caller that sends no `Origin`
  header (anything but a browser) may name any domain in the body, and only
  Apple's own registration check stands between it and a session for that
  domain.
- **Rate-limit the route.** It is public by design (the buyer may not be
  signed in yet), and every request that passes the URL check costs one
  mutual-TLS call to Apple.

**The identity is a port**, `ApplePayIdentityPort.merchantIdentity(merchant)`,
which answers `{ merchantIdentifier, displayName, certificate, privateKey,
domains? }` or `null`. Whether that is one platform identity or one per seller
is the host's decision (FUT-773). Pass the same port to `buyerCheckoutConfig`
(`applePay`) or to `createPaymentFlowsBE` (`applePay`): **without a merchant
identity the buyer config no longer declares `APPLE_PAY`**, even for a provider
whose capabilities list it. A stub connection still declares it, but only so
an e2e suite can render the button: validation on a stub store with no
identity still answers 409. Only `buyerCheckoutConfig` and the
`createPaymentFlowsBE` `/config` row are gated. The older library `config`
route on `mountPayments` (`getClientConfig`) still publishes the raw
capability table, so a host should not draw an Apple Pay button from it.

### Homologação evidence in production (`@12-apps/payments-backend/homologacao-evidence`, FUT-4198)

`createHomologacaoEvidence` takes an `environment` (`'SANDBOX'` when absent).
A host that needs PagBank's production evidence mounts a SECOND service:

```ts
const production = createHomologacaoEvidence({
  ...sandboxConfig,
  environment: 'PRODUCTION',
  // Its own PLATFORM merchant: a provider row holds ONE active environment,
  // so connecting the sandbox seller to production would break the sandbox run.
  merchant: { kind: 'PLATFORM', id: 'homologacao-seller-production' },
  webhookUrl: `${base}/api/webhooks/platform-homologacao-producao/pagbank`,
  copy: PT_BR_HOMOLOGACAO_EVIDENCE_PRODUCTION_COPY,
});
```

- **Behaviour change — the evidence table needs `environment`.** The Prisma
  store now writes `environment` on create and filters every read by it, for
  BOTH services. Add the column before taking this version: text, `NOT NULL
  DEFAULT 'SANDBOX'`, CHECK `IN ('SANDBOX','PRODUCTION')`. Existing rows then
  read as sandbox, which is what they are.
- **Every order is R$ 1,00 of real money**, and the run refunds each one.
  `prepare(buyer)` and `run(..., buyer)` take the real cardholder
  (`EvidenceBuyer`); phase 1 echoes their 3DS data back as `debitTest`. Their
  CPF/CNPJ and phone are masked by the traffic recorder (last 2 and last 4
  digits) in every recorded call, sandbox included.
- **The Pix waits for a person.** Phase 2 raises the QR and leaves
  `pix.consult`, `pix.paid` and the production-only `pix.refund` PENDING; mount
  a route for `confirmPix(runId, 'CHECK' | 'SKIP')`. `CHECK` consults once and,
  when PAID, refunds and records it; `SKIP` records that it was never paid.
- No declined card in production: `card.declined` stays PENDING and says why.
- The file is named `pagbank-homologacao-evidencias-producao-<stamp>`, so it is
  never confused with the sandbox one.

## 3. Frontend wiring

- Settings page: render `<PaymentProviderSettings client={...} />` where the
  provider config screen lives today. It renders every registered provider
  from its credential schema — adding a vendor changes NOTHING here.
  Its `copy` (`PaymentsSettingsCopy`) is required: `PT_BR_PAYMENTS_SETTINGS_COPY`
  or `EN_US_PAYMENTS_SETTINGS_COPY`, or `PAYMENTS_SETTINGS_COPY[locale]` from
  `./locales`. Its optional `failures` block words a failed request by the
  gateway's error code — `byCode` (a `Partial` map from the code, e.g.
  `CredentialsError`, to a sentence) and `generic(status)` for any code left
  out, where `status` is `null` when nothing answered. The screen never shows
  the server's own `message`, which is developer English; it still reaches the
  console and error reporting on the thrown `PaymentsClientError`, which now
  carries the code as `code`. A pack without `failures` reads the English
  pack's sentences. Both shipped packs fill it.
- The buyer checkout: mount `createPaymentFlows(...).Checkout` (below) — its
  Pagamento step is the one payment list. The standalone `CheckoutPayment`
  method-card step was removed with the tabbed checkout (FUT-4028).

### The activation step, mounted (`createActivationStep`, FUT-764)

`renderVerification` on `<PaymentProviderSettings>` is where step 3 goes —
"connected" and "can charge" are different facts, and this is the step that
proves the second by putting a real, small charge through the store's own
account.

That slot used to hand the host the whole screen. It read as a boundary and was
not one: what goes in it is a rendering of `useActivationCharge` and
`useRedirectActivation`, both of which ship here. The origin host's copy of it
was six outcome panels, a polling display, a link fallback and a router between
two flows — ~800 lines whose comments are a list of real payments that went
wrong. A second adopter would have had to learn the same lessons from the same
kind of incident.

So bind it once and put the result in the slot:

```tsx
// activation-step.ts — one module, one call
export const ActivationStep = createActivationStep({
  verifyChargeUrl: (provider) => `/api/admin/${slug}/payments/verify/${provider}`,
  copy: MY_ACTIVATION_COPY,      // required, and there is no default
  formatAmount: (cents) => myMoney(cents),
  CardSurface: MyCardProviders,  // your design system + your card words
  validateTaxId: myTaxIdValidator,
  storageKey: "my:verify-settlement",   // only if you shipped this before
});

// …and in the settings page
<PaymentProviderSettings
  renderVerification={(context) => (
    <ActivationStep
      {...context}
      ownerEmail={session.user.email}
      storeUrl={storefrontUrl}
      onProviderOrder={() => openProviderList()}
    />
  )}
/>
```

What the step decides for you, and why each one is a lesson rather than a
preference:

- **A provider with no in-browser card path gets a payment LINK, not a card
  form.** Rendering fields for a key that was never going to exist produced a
  dead end blaming the store.
- **An already-proven connection renders the proof, never the pay button.** One
  owner read a re-offered button as "it did not work" and paid four times.
- **Three creation failures are three screens.** Refused (a provider-side
  switch — a step, not an error), unreachable (the provider refused nothing, so
  blame nothing), and refused-on-payment (the connection is fine). One panel
  served all three and could only give the first one's advice.
- **`blocked` withholds the pay BUTTON and nothing else.** An outstanding
  charge, a return trip, a settled result all keep rendering: hiding them
  behind a setup step is how a payment stops being confirmable.
- **An unpriced charge names no amount.** Not every provider accepts one cent,
  so nothing here guesses — your `outcome.someAmount` fills the gap until the
  endpoint answers.

**`storageKey` matters on a repeat adoption.** An owner can be on the
provider's site paying RIGHT NOW across a deploy; their ids sit in
`sessionStorage` under whatever key you shipped, and reading a different one on
the way back finds nothing and offers to mint a charge for a payment they just
made.

**`CardSurface` is not optional decoration.** The card fields are this
package's own, so they read the checkout copy context — a bare passthrough
throws at the mount. That is deliberate: the owner testing their connection
must meet the SAME form, validator and tokenizer their shoppers will, or the
test proves something about a path that never takes money.

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
    <flows.screens.PixPayment payable={payable} onResolved={done} />
    <flows.screens.CardEntry payable={payable} onResolved={done} />
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

**`POST /release` is the buyer saying they did not pay** (FUT-1146). A
cancelled or refused payment on a provider's own page produces no signal
anywhere — the hosted check publishes `success`/`paid` and no status field, an
unpaid webhook delivery fails verification before it is parsed, and the poll
answers the payable's own status unless the provider says PAID — so the waiting
screen had no terminal state to reach. This row asks the provider first and
answers `PAID` (settling, releasing nothing) when it turns out they did pay;
only a payable with no payment behind it is let go. The client sends the
settlement hints in the query, exactly as the poll does, because for a hosted
provider they are the only way to ask at all.

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

The buyer flow — Pagamento as the ONE payment list (the CPF at its top, PIX
QR + polling, card form + tokenization, saved cards, wallets, hosted-checkout
redirect + return resume) → Confirmação — mounts in one line:

```tsx
<CheckoutFlow
  cart={{ empty, totalLabel, totalItems }}   // display facts, never money math
  createOrder={(input) => ...}               // REQUIRED — see ports below
  onExitToMenu={() => ...}                   // REQUIRED — leave for your catalog
  paymentList={{ copy: PT_BR_PAYMENT_LIST_COPY }} // REQUIRED — the Pagamento step (below)
/>
```

There is no other Pagamento. The Dados step, the Pix/Cartão method tabs, the
flow's own "Etapa N de M" header, one-click (`oneClick`) and the checkout
pipeline were removed in FUT-4028; the list does what each did (the CPF at the
top, the rows, the host's own stepper, the last method preselected).

It talks to the host-mounted `/api/checkout*` surface (`/api/checkout/status`,
`/config`, `/charge`, `/cards`, `/refresh-key`) and speaks the store's ACTIVE
provider protocol end to end — PagBank (PIX + SDK-encrypted card), Stone
(Pagar.me token), InfinitePay (hosted redirect, resumed on return) — with no
provider branching in host code.

**The ports (host domain stays in the host).** Cart, catalog, comanda and
order CREATION never enter the package; they arrive as explicit props:

| port | required | what the host does with it |
| ---- | -------- | -------------------------- |
| `cart` | yes | `{ empty, totalLabel, totalItems, discountLines?, identity? }` — read from YOUR cart; `discountLines` is your own rendered discount itemization, and `identity` is what binds a parked payment to a basket (below) |
| `createOrder(input)` | yes | raise the order from your cart/comanda; close over tenant + comanda scope; answer `CreateOrderResult` (`{ok:true,data:CheckoutOrder}` or a structured `CheckoutError`) |
| `onExitToMenu()` | yes | navigate to your catalog |
| `saveBuyerContact(contact)` | no | persist name/phone/CPF when the list raises an order under "salvar meus dados" (LGPD-gated by the list); the WIRE rules — e.g. a blank CPF must be omitted, never sent as `""` — are yours |
| `onPaid()` | no | the order settled PAID — re-read your server-emptied cart |
| `comanda` | no | `{ scope, totalLabel, totalItems }` when settling a comanda instead of the cart |
| `taxIdOnFile` | no | `true`: the list shows the payer line instead of the CPF field (FUT-465); its "Alterar" reveals the field |
| `taxIdKindOnFile` | no | `"CPF"` or `"CNPJ"`: which document is on file, for a host that never hands the digits over — the payer line then names it ("CNPJ ✓") instead of falling back to "CPF". A document in `defaultBuyer.taxId` or typed in the list wins (FUT-4080). Mount `CheckoutFlow` to pass it: `createPaymentFlows`'s Checkout reads its buyer from `useBuyerDefaults`, which does not carry the kind yet |
| `providerConfig` | no | the `GET /api/checkout/config` answer (`fetchCheckoutConfig` is exported); `null` while loading degrades safely |
| `tenantSlug` | no | scopes the saved-card list to the store being paid |
| `confirmationExtra` | no | host content on the PAID confirmation, ABOVE the action row — put what the buyer has to DO next here, beside the way out |
| `confirmationHero` | no | an illustration that REPLACES the PAID confirmation's icon (the storefront's mascot on a buyer's first order) — pass it only when there is one, and mark it `aria-hidden`: the heading beside it carries the meaning |
| `confirmationFooter` | no | host content on the PAID confirmation, BELOW the action row — put what is merely OFFERED here (an install invite, an ask to turn alerts on), so a panel never lands between two controls |
| `backActionEmphasis` | no | `"secondary"` when the host renders its own lead action in `confirmationExtra`, so the flow's "back to the menu" stands down instead of being a second primary. Read on PAID only; defaults to `"primary"` |
| `paymentList` | **yes** | the Pagamento step — see "The Pagamento step as ONE list" below |
| `parkHostedOrders` | no | `false` for a SECOND mount of the flow that pays something you already track yourself (a pedido paid again from its own page): it keeps out of the parked-payment slot your one checkout uses — see the parking paragraph below. Defaults to `true`; `createPaymentFlows`' Checkout screen does not pass it |

**Three copy keys are new and REQUIRED on this bump**, and a hand-written pack
that misses one fails at RUNTIME rather than at compile time if the host does
not typecheck the file (the consumer harness in this repo did exactly that, and
every checkout page in it died on the first render):

| key | where | what it is |
| --- | --- | --- |
| `views.screens.totalCaption(items)` | the pay bar, on BOTH steps | "Total · 2 itens" — a function, because the count inflects. It was compiled-in Portuguese until FUT-1179 put the bar on a second step. **Called unconditionally**, so an absent one is a `TypeError` that unmounts the checkout. |
| `views.status.declined` | the confirmation | one `{heading, support}` per normalized decline reason (FUT-1145); a reason with no entry falls back to `views.status.failed`, so a partial table is legal and `UNKNOWN` is meant to be absent. **Indexed**, so an absent `declined` object is a `TypeError` on the first refusal. |
| `views.status.notPaidAction` | the confirmation | the buyer's "I could not pay" (FUT-1146). |

**`cart.identity` — WHICH basket this checkout is for (FUT-1213).** Pass
`{ signature: basketSignature(lines), ready }`, where `lines` is your cart's
own `{ id, quantity }` list and `ready` is false while that cart is still
loading.

> **PASS IT UNCONDITIONALLY, `ready: false` and all.** Computing `identity` only
> once the cart has data — the natural shape, and the one a careful host reaches
> for — hands the flow `undefined` in the meantime, and `undefined` means "this
> host has not adopted the port": the pre-1213 resume, silently, on exactly the
> mount where the decision is made. The package cannot tell the two apart, so
> this is the one line of the wiring that has to be right by construction. The
> same goes for `hostedCheckoutReturnPending(slug, basket)` below.

`basketSignature` is exported from the package root; the identity is
the LINES because "Esvaziar carrinho" keeps the cart row, so a cart id says
"same basket" for a shopper who threw the old one away.

Without it the flow keeps its pre-1213 behaviour: a payment parked by a hosted
hand-off resumes on whatever checkout mounts next, which is how a shopper who
never paid met "Confirmando seu pagamento" over a live basket for fifteen
minutes. With it, a parked payment met by a DIFFERENT basket is asked about
once (`GET /status`) and resumed only if it is PAID.

Two related behaviours ride on the same wiring: every raised order is parked,
not only a hand-off (FUT-1140), so a discarded tab comes back to the payment it
raised rather than to an empty cart; and a resumed order lands on the
confirmation for a hand-off and back on the PAYMENT step for a code raised on
our own page, because that code is still what the buyer needs to look at.

**A second mount keeps out of the slot: `parkHostedOrders={false}`.** The slot
is one per tab, shared by every mount of the flow. A host that mounts the flow
again to pay something it already tracks (a pedido paid again from its own
page) passes `false` there. That mount then does not park an order it raises
on the page, including one that comes back already settled. It does not resume
the slot on mount, and it forgets nothing. So the next checkout never resumes
that mount's Pix over a basket nobody ordered, and the mount never takes the
checkout's parked payment as its own.

What it KEEPS is the hand-off: a provider's redirect, a card's or a wallet's
3-D Secure still parks. The mount's page is gone after the redirect, the
provider returns to your checkout route, and that entry is what lets the route
open the confirmation for the payment the buyer just made. A hand-off the buyer
ABANDONS (never comes back from) stays parked, with no basket, for up to
`MAX_PARKED_AGE_MS` (30 minutes), and can resume over your checkout in that
window — exactly as any basket-less hand-off did before this prop existed.

**Pass the same basket to `hostedCheckoutReturnPending(slug, basket)`.** That
predicate is what a host gate in front of the checkout route asks — a
closed-shop curtain, a plan check — and it now mirrors the resume's rule
instead of merely asking whether anything is parked: this store, not stale, and
still about the basket in front of the shopper (the same one, or an empty one).
Both directions matter and only the host can supply the basket to both: a buyer
who paid comes back to an EMPTY basket — the server closes a paid cart — so the
predicate is true for them and "Pedido confirmado" is reachable at a shut store,
while a buyer who abandoned and rebuilt a different basket meets the curtain,
which is what a shut store is for. The gate is deliberately local, so it cannot
ask the server: a payer who somehow returns holding a DIFFERENT basket is
blocked by it, and the resume behind it never runs to discover they had paid.
Their order is still settled server-side and still in their purchases; what they
lose is meeting the confirmation on this visit.

A host that passes no basket keeps the WIDE pre-1213 answer — anything
parked stands the gate aside — so migrating `cart.identity` without migrating
this call leaves half the fix on the floor. The check stays local and
non-consuming, so a gate may ask it on every render; a host that freezes the
answer at mount must not freeze it before its cart is `ready`.

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

Nested providers **add**: an inner one fills the slots it names and inherits
the rest from the provider above it, not from the raw-MUI defaults. So slots
filled once at `createPaymentFlows({ components })` survive every screen
underneath — including the `<flows.Checkout />` mount, which opens a provider
of its own — and a subtree can narrow the look further without restating the
whole table.

The slots, each with a deliberately narrow prop contract (`Checkout*Props`
types are exported; the props are the subset the checkout actually uses, so
any design system satisfies them with a thin — often identity — mapping):

| slot | contract highlights |
| ---- | ------------------- |
| `Text` | semantic `variant`/`size`/`weight`/`color`, `as`, `data-testid` |
| `Button` | `variant` solid/outline/text, `color`, `size`, `fullWidth`, `loading`, `icon`, `dataTestId` **on the button element** |
| `Input` | `label`, `error`+`helperText`, `endAdornment`, `data-testid` **on the `<input>` itself** (e2e fills it); `inputProps` (typing hints: `autoCapitalize`/`autoCorrect`/`spellCheck`, FUT-4107) must reach the `<input>` too |
| `Checkbox` | `checked`, `onChange(event, checked)`, `label`. The list's consent row under the CPF (FUT-3711) sits flush with the field by zeroing MUI's `.MuiFormControlLabel-root` inset and `.MuiCheckbox-root` padding inside it — a Checkbox built on MUI's (the default, `@12-apps/ui`'s) is flush; one built otherwise keeps its own inset |
| `Alert` | `variant` info/warning/danger, `title`, `description`, `showIcon` |
| `LoadingState` | spinner + `message` |
| `Stepper` | `steps[{id,label}]`, `activeId`, `completed` |
| `RadioGroup` | `options[{value,label,description}]` (the saved-cards list) |
| `ActionBar` | the bottom CTA bar — host chrome (this repo's storefront passes its `StickyActionBar`) |
| `lazy` | not a primitive: the loader for the parts of a screen deferred to a chunk of their own, React's `lazy` signature — see "Deferred parts" under the one list. Absent ⇒ React's `lazy` |

Layout stays raw MUI `Box` INSIDE the package (MUI is already a peer), so
slot implementations never receive layout responsibilities; test ids are
identical through every slot implementation — they are the same hooks the
storefront journeys click.

This repo's `@12-apps/ui` binding lives in `@12-apps/spa-shared/payments-ui`
(`checkoutUiComponents`); the storefront spreads it plus its `ActionBar`, and
`@12-apps/spa-shared/card` re-exports the card form pre-wired with it for the
admin's activation charge. The second-host proof is the package's own
`src/components/checkout/__tests__/second-host.test.tsx`: the flow walks
the list → the card row's form with NO `@12-apps/ui` present (it is not even
resolvable from the package), rendering entirely through the raw-MUI default
slots.

### The Pagamento step as ONE list (`paymentList`, FUT-3591/3592)

REQUIRED since FUT-4028 (it was opt-in beside the method tabs, which are gone):
the Pagamento step is one radio group — the store's online options under
"PAGAR AGORA, PELO APP" and the HOST's own pay-at-the-door options under
"PAGAR NA ENTREGA" — over one bar whose button is the only thing that raises an
order or a charge:

```tsx
import { PAYMENT_LIST_COPY } from "@12-apps/payments-frontend/locales";

<CheckoutFlow
  /* …every prop from the table above… */
  paymentList={{
    copy: PAYMENT_LIST_COPY[locale],           // REQUIRED, no default
    summary: "2 itens · Taxa de entrega R$ 5,00", // the bar's first line, yours
    onlineExtras: <StoreCreditCheckbox />,     // in the bar while an ONLINE option is chosen
    door: useDoorOptions(),                    // CheckoutDoorOption[] — see below
    hold: addressOpen ? { action: "Confirme o endereço", reason: "Confirme o endereço no passo 3." } : null,
    totalCents: 2200,                          // integer cents: the AMOUNT DUE online, after a balance you hold
    amountDueLabel: "R$ 22,00",                // the same, formatted — only when it is not the cart's total
    onChoiceChange: (choice) => setChoice(choice),
  }}
/>
```

What changes for the buyer:

- **Picking creates nothing.** No order is raised on a pick, and a store's only
  method is no longer chosen for them. A saved card is the one thing that comes
  chosen — "Cartão de crédito" with the card used LAST selected: the one whose
  `SavedCard.lastUsedAt` is latest, or the head of your list when no card says.
  Answer `lastUsedAt` on `/cards` (stamp it when a charge with the card goes
  through).
- **The CPF is asked once, at the top of Pagamento** (FUT-3685), above the
  wallets: it shows when ANY online method or
  wallet the list offers needs it under the chain rule (the union, never the
  chosen row), with "o PagBank pede para pagar pelo app" under it — the
  provider named is the chain member that asks. The field is ~280px once the
  list itself is at least 560px wide — read off the list's own container, so
  it stops in your own ~680px left column too — and full width under that. Until it is valid, the wallet
  buttons and the online rows' button are held with `copy.reasons.cpf`; a door
  row never is. A buyer with one on file sees no field but the payer line, and
  its "Alterar" reveals the field at the top. The hand-off provider's mobile is still asked inside its own row.
- **The field takes a CPF or a CNPJ** (FUT-4080), "CPF ou CNPJ": a buyer
  paying with a company card gives its CNPJ. It is masked `000.000.000-00` up
  to 11 digits and `00.000.000/0000-00` from the 12th, accepts either pasted
  with or without punctuation, checks the check digits of either, and keeps
  PLAIN DIGITS in the buyer state — so `createOrder`, `saveBuyerContact` and
  the charge body all carry digits. Numeric CNPJs only: the adapters strip the
  value to digits, so the alphanumeric CNPJ is not accepted yet.
  **Behaviour change:** `createOrder`'s `buyer.taxId` and `saveBuyerContact`'s
  `taxId` now carry plain digits (`52998224725`), not the masked CPF
  (`529.982.247-25`) they carried before; a host that parsed the mask must read
  digits. The focus moves on to "Número do cartão" only for what cannot grow: a
  valid CNPJ, or a valid CPF pasted or autofilled whole — a CPF typed digit by
  digit may be the start of a CNPJ, so the field keeps the focus.
- **No confirmation dialog.** The card's "Pagar" becomes a bar that fills in
  five seconds (`CHARGE_WINDOW_MS`) with "Cancelar" under it; nothing is sent
  before it fills. "Gerar Pix" raises the order and the code at once, and the
  code copies on a tap. A hand-off store's single "Pix ou cartão" row goes
  straight to the provider's page.
- **The wallets are a block above the rows** (FUT-3685): "PAGAMENTO RÁPIDO",
  the ready wallets' buttons (Google's drawn by `createButton`, Apple's by
  Safari's `-apple-pay-button`), then "ou escolha como pagar". A wallet is
  ready when the chain head declares it AND the device can pay AND the card is
  offered here (so a Pix-only store shows no block); Apple also needs your
  `validateApplePayMerchant` port. None ready ⇒ nothing at all; two ⇒ side by
  side from the theme's `sm`. A press opens the wallet's sheet INSIDE the tap,
  priced at `totalCents` (the amount due), raises a CARD order in parallel and
  charges the key only when that order's `amountDueCents ?? totalCents` is the
  sheet's amount. Pressing a wallet never changes the chosen row.
- **On a computer** (the flow's frame ≥ 900px, the `md` breakpoint), the step
  sits beside a "Resumo do pedido" column: `cart.lines` (or, settling a ready
  total, your `paymentList.lines`), `cart.discountLines` (your fee and discount
  rows), "Total", then `summary`, the extras and the pay button — no bar at the
  bottom. On a phone the bar stays, and its first line (your `summary`)
  carries "Ver resumo": it opens a sheet above the bar with the same body as
  the column — the lines, `cart.discountLines`, "Total" and the credit rows —
  fetched on the first tap (FUT-589). The bar stays usable under it; Escape,
  the ✕, the scrim and the line close it, and any charge the bar starts (the
  card's 5-second bar, a wallet) closes it, as does the payer line's
  "Alterar", which opens the CPF at the top. Only the list face has it: the Pix
  screen and the hand-off keep their plain line. Your money rows are drawn
  there READ-ONLY: a control among them reads `useInSummarySheet()` (exported
  from the package root) to leave itself out, as it does in your own column.
  Because the whole line is ONE button on a phone, `summary` is drawn inside
  a `<button>`: pass non-interactive content only (text, an icon) — a link or
  a button in it would nest one control in another, which is invalid HTML and
  breaks screen readers.
- No `orderNote`, and no step header anywhere in the flow: the host's own
  stepper is the chrome around it. The list's `copy.title` names the list
  for a screen reader only.

**The list's own fields.**

| field | what it is |
| --- | --- |
| `copy` | the list's words — `PAYMENT_LIST_COPY[locale]`; required |
| `summary?`, `onlineExtras?` | the bar's first line — non-interactive text, since on a phone it is drawn inside the "Ver resumo" button; what joins it while an online option is chosen |
| `door?` | your pay-at-the-door options — the slot below |
| `hold?` | `{ action, reason }`: the button reads `action` and is held, `reason` under it |
| `totalCents?` | integer cents — the AMOUNT DUE online: the cart's total, less a balance you hold (store credit). Both wallets' sheets are priced with it, and a key is charged only when the order raised behind the sheet asks the provider for the same amount — `order.amountDueCents ?? order.totalCents`. **A host without it, or at `0`, gets no wallet buttons.** Once given, a moment without it (you are re-pricing) keeps the buttons' place, held plainly with `copy.reasons.repricing`, until it returns |
| `amountDueLabel?` | the amount due, formatted, when a balance pays part of the cart. The card's button, the 5-second bar and the Pix face name it while an online option is chosen; a door option keeps the cart's total. With nothing chosen the held button names no amount (its words take the width), so on a phone the bar draws "Total" and the cart's total above it; the computer's column already does. Absent ⇒ the cart's total |
| `lines?` | `{ key, quantity, name, totalLabel }[]` — your own lines for the computer's "Resumo do pedido" column, drawn above "Total" **in place of `cart.lines`**, for a checkout that settles a READY total (`settlement` / `totalOverride`: a comanda's conta), where the cart is not what is being paid (FUT-3692). Read only then: a cart checkout keeps `cart.lines` and ignores this. The computer's column, and on a phone the "Resumo do pedido" sheet the bar's line opens (FUT-589), draw them. **"Total" is never computed from them**: it is the ready total, whatever the lines add to. A gap between the two (a taxa de serviço) is yours to show through `cart.discountLines`, which a ready total still draws beside "Total"; make those rows describe the conta, because nothing reconciles them with the lines. Absent ⇒ "Total" alone, as before |
| `credit?` | `{ label, amountLabel }` — the balance paying part of the cart, worded and formatted by you (`{ label: "Crédito da loja", amountLabel: "− R$ 5,00" }`, FUT-3711). With `amountDueLabel`, the computer's "Resumo do pedido" column draws it under "Total", then "A pagar" (`copy.amountDue`) and the amount due — Total − credit reads as what the button charges — while an ONLINE option is chosen. A door option or no choice charges the cart's total, so "Total" stands alone; without either field, "Total" alone |
| `lastMethod?` | `"PIX"` or `"CARD"` — the buyer's last ONLINE way to pay, as the host remembers it (FUT-3611). Chosen before the buyer touches anything when the store offers it: Pix as Pix, a card as the saved card used last. Never a door tender. Absent ⇒ the saved-card rule alone |
| `armedCharge?` | the host's own consent screen already took the tap ("Pedir em 1 toque", FUT-3611): the card's 5-second bar starts by itself, once, as soon as a SAVED card is chosen and nothing holds the button. Without a saved card it does nothing; Cancelar still sends nothing |
| `chargeFooter?` | `(cancel) => ReactNode` — host content under the 5-second bar's Cancelar while it counts (the storefront's opt-out link). Handed the bar's own cancel, so it stops the charge first |
| `pixBank?` | `{ remembered, onPick, copy, phone? }` — Pix straight to the bank app (FUT-3612). The button reads "Gerar e copiar o Pix" (or "Gerar, copiar e abrir o Nubank" with a bank remembered) and copies in the same tap; on a phone the after-copy face shows six banks (2×3, logos) in place of the checklist, or opens the remembered one with "Outro banco"; "Abrir outro banco" sits under the button. A bank that does not open (the page still visible ~1.5 s later) says so, with "Tentar de novo". `onPick` is the host's to persist; `copy` is `PIX_BANK_COPY[locale]` from `./locales`. `phone` overrides the browser's own answer (tests). A computer gets the one-tap copy and the toast only |
| `notify?` | `(message) => void` — the host's toast, for "Código Pix copiado" (+ ". Escolha o banco." / ". Abrindo o Nubank…") |
| `onChoiceChange?` | every change of choice, door ids included |

**What else the list reads (FUT-3685).**

| what | your part |
| --- | --- |
| `CheckoutFlowProps.validateApplePayMerchant` | the Apple Pay merchant-validation port (server-side). The list offers no Apple Pay without it — its session could only abort. `ports.validateApplePayMerchant` on `createPaymentFlows` |
| `cart.lines`, `cart.discountLines` | the "Resumo do pedido" column on a computer: your lines, then your fee/discount rows above "Total". `cart.lines` is the cart's: settling a ready total it is not drawn, and `paymentList.lines` takes its place; `cart.discountLines` is drawn either way |
| `paymentList.summaryTarget` | lay out the computer's two columns YOURSELF: your step cards on the left (≤ 680px), and an element of yours on the right — pass it here and the list portals the whole "Resumo do pedido" column into it (lines, money rows, Total, `summary`, extras and the pay button), with no bar at the bottom. `null` while your element is not mounted yet (the bar waits rather than flash). Leave it out on a phone, or to keep the list's own layout (the step and the column side by side once the flow's frame is ≥ 900px). The Pix screen and the hand-off always keep their bar |
| `defaultBuyer.taxId` with `taxIdOnFile` | the CPF or CNPJ on file, plain digits: "Alterar" on the payer line opens it at the top, filled — masked as a CNPJ when it is one — and editable, and the payer line names the kind ("CNPJ ✓"). Without it the field opens empty and the line names `taxIdKindOnFile`, or says "CPF ✓" when that is absent too. Either way the field is optional while a document is on file — empty keeps the saved one, only a typed CPF or CNPJ that is not valid holds the online ways to pay — and "Manter o documento salvo" (`copy.buyer.keepSavedCpf`) closes it again, dropping what was typed |
| `onlineExtras` | drawn whenever a payment here is possible — the list offers an online row or a wallet, and no door row is chosen (nothing chosen counts: a wallet pays with no row). The payer line follows the same rule |
| `copy.wallets`, `copy.buyer.cpfHint` | new in the packs: "Pagamento rápido", "Pagar com Google Pay", "Pagar com Apple Pay", "ou escolha como pagar"; "o PagBank pede para pagar pelo app". A host building its own `PaymentListCopy` adds them. `copy.googlePay` is no longer drawn |
| `CheckoutOnlineChoice` | never `"GOOGLE_PAY"` any more: the wallets are not rows, so `onChoiceChange` does not report one |

**Deferred parts — the `lazy` slot (FUT-3711).** Two parts of the list are
chunks of their own, so a checkout that never draws them never parses them:
the top (the CPF field and the "PAGAMENTO RÁPIDO" block, drawn only when a CPF
is asked or a wallet is ready) and the computer's "Resumo do pedido" column
(never drawn on a phone, nor by a checkout that does not mount the list). The
list builds both through `components.lazy`, a function with React's `lazy`
signature, `(factory) => Component`:

```tsx
import { lazyRoute } from "@12-apps/app-shell/react";

<CheckoutFlow components={{ ...mySlots, lazy: lazyRoute }} ... />
// or once, at the factory: createPaymentFlows({ components: { ...mySlots, lazy: lazyRoute } })
```

- **Pass your stale-chunk-safe loader.** A host whose deploys replace hashed
  chunks must: a tab opened before a deploy asks for a chunk that is gone,
  and React's `lazy` — the default when the slot is unfilled — throws that to
  the nearest error boundary. `lazyRoute` reloads onto the current build
  instead. Any function `typeof React.lazy` fits (`CheckoutLazy`, exported).
  The list starts the top's chunk as soon as it mounts, so a loader that
  reloads on a stale chunk does it then — before the buyer has typed anything —
  not when "Alterar" is tapped.
- **Pass the same function every render** — a module-level one, as above.
  Each loader's components are built once and kept against it; a new arrow per
  render re-suspends both parts on every render.
- **The top and the rows land together.** The top's chunk starts when the
  list mounts; until it lands neither the top nor the rows are drawn (the bar
  is), so no row is drawn and then pushed down under a finger. A top opened
  later ("Alterar") is already in hand and hides nothing. What the CPF holds is
  decided outside the chunk: the online rows' button and the wallets are held
  with `copy.reasons.cpf` before the field is on screen. A test can wait for
  `list-top-loading` to be gone before asking what the top shows.
- **The column's frame, heading and pay-button slot are drawn at once** (in
  your `summaryTarget` when you pass one), with the bar's content in that one
  slot from the first render: only the lines, the money rows, "Total" and the
  credit rows load, and their landing moves nothing — the focus on "Pagar",
  your extras' state and a 5-second bar counting all stay.
- **A chunk that fails to load** is caught per part: the rows, the column's
  frame and the pay button stay, nothing is drawn in the part's place, and the
  part is imported once more a second later.
- A bundler rule that merges small chunks may fold both back in; a host that
  keeps chunks apart by module names `list/list-top-body` and
  `list/summary-column-body`.

**The door slot.** Paying at the door raises no charge, so it is the host's:

| field | what it is |
| --- | --- |
| `id`, `label`, `hint?` | the row; `id` comes back through `onChoiceChange` |
| `content?` | what opens INSIDE the row while chosen (troco, tender chips, brand lines). Also a function `({ chosen, choose }) => ReactNode`: `choose()` is what the row's radio does (a no-op on the chosen row), so a control inside can choose the row in the tap that answers it (FUT-3715). The choice still reaches `onChoiceChange` from an effect, after the render, so keep an answer given in that tap across it. It is called during the row's render, not mounted: return a component of your own if the content needs hooks |
| `showContentWhileIdle?` | draw `content` while the row is NOT chosen too, on the unchosen frame, in the same place it keeps once chosen — for answers that are themselves the way to choose the row (FUT-3715) |
| `hideHintWhileChosen?` | drop the hint while the content says the same at length |
| `action` | the bar button's verb while chosen — "Enviar pedido" |
| `totalLabel?` | the amount beside it; absent ⇒ the cart's |
| `blocked` | why it cannot send yet, shown under the button; `null` ⇒ it can |
| `pending?`, `error?` | your send in flight; a refusal of the last one |
| `onSend()` | the press — place the order yourself |

Rebuild the array whenever any field changes: the list draws what it is
handed on every render.

**A balance you hold (store credit).** The list does no money arithmetic; you
tell it the amount due, and your server tells it what each raised order owes:

| what | your part |
| --- | --- |
| `CheckoutOrder.amountDueCents` | answer it on every raised order when a balance pays part of `totalCents`: the cents the provider is asked for. **A credit host that leaves it out has every wallet key refused** (its total is not the sheet's); in development the list says so with a `console.warn`. |
| the wallet charge | your `/charge` route must check the wallet amount against the order's CURRENT amount due, not its total — the sheet was priced with the amount due |
| everything covered (`totalCents: 0`) | the card option asks for no card, and the bar says `copy.chargingCovered`. The order the button raises must come back SETTLED — paid from the balance with no provider call, status not `AWAITING_PAYMENT` — so the list goes to its paid screen. An order that comes back awaiting with `amountDueCents: 0` is never charged; the list gives its rows back |
| `copy.chargingCovered?`, `copy.reasons.repricing?`, `copy.amountDue?` | the bar's sentence for a covered order; the reason under the wallets held while you re-price; "A pagar", the column's row under your `credit` (absent ⇒ neither row is drawn). The packs carry all three | `usePaymentList` on `createPaymentFlows` is the same
thing for the mounted flow, read as a hook.

**Known limitation.** The rows' radios are MUI's own `Radio`, not a checkout
slot, so a host on another component kit gets MUI's radio dressed by its
theme; the keyboard ring is drawn on the whole row for its own radio only
(`:has(> label input[type='radio']:focus-visible)`), so a field opened inside the row
draws its own ring and no second one.

## 4. Migrating the existing PagBank integration

1. Wrap `apps/web/lib/payments/pagbank.ts` as `pagbankProvider():
   PaymentProviderAdapter` (its results map cleanly onto `ChargeSnapshot`).
2. Register it in the host registry; migrate the `payment_integrations` rows
   into `payment_provider_configs` (same masked/preserve semantics).
3. Point order charge/webhook paths at the gateway; delete the app-local
   plumbing the gateway now owns.

**Do not keep PagBank's hostnames.** `pagbankApiBase(environment)` is exported
from the package root and answers the Orders API host for `'SANDBOX'` or
`'PRODUCTION'`. A host that writes those two URLs itself has forked a vendor
fact that is identical for every deployment — and since both copies agree on
the day they are written, the fork is invisible until one of them changes,
which on this surface means a live charge sent at the sandbox host or the
reverse. The first adopting host had exactly that copy (FUT-760).

The environment is a REQUIRED argument, deliberately: a helper that guesses
when asked about "no environment" is one that can route money at the wrong
host silently. Resolve the environment at your own seam and pass it.

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
or repo-specific package. Portability rules:

- backend: no database/ORM/framework in core; adapters speak `fetch`; no
  provider SDKs; Prisma coupling only via duck-typed delegates. The one
  transport that is not `fetch` is `providers/mtls.ts`, for a provider that
  authenticates the CALLER with a client certificate (Itau): `fetch` can only
  present one through undici's `Agent`, a dependency this package does not
  take, so it goes over `node:https` behind the same `providerFetch` seam —
  same retry rule, same error mapping, still no SDK. A custom
  `ProviderConfigStore` MUST implement `setActiveProvider` atomically —
  the interface requires it and there is no sequential fallback.
- frontend: imports only TYPES from the backend package; talks only to the
  host's mounted HTTP surface; MUI + React as peers.

### Three of them are a lint gate, not a review item (FUT-562)

This list used to say "enforced by review". It is worth being blunt about what
that bought: review is why a host storefront drifted into a PagBank-shaped
checkout, why super-admin grew a 1,165-line fork of the settings page nobody
noticed, and why a webhook handler was still parsing `body.order_nsu` — one
vendor's payload field — in code whose commit message said it had removed
provider names. Every one of those is mechanically detectable.

`pnpm quality:portability` (root `eslint.payments-portability.config.mjs`, CI
job **Payments Portability**) now errors on:

| rule | what fails |
| --- | --- |
| `payments/no-host-imports` | anything under `packages/payments/**` importing a sibling workspace package (`@12-apps/*`, `@repo/*`), the consumer harness, or a relative path that climbs out of the folder |
| `payments/no-provider-name-literal` | a provider's name in a string literal, template chunk, JSX attribute/text or object key ANYWHERE outside `packages/payments/**` — tests, stories, fixtures and migrations excepted |
| `payments/frontend-types-only` | `packages/payments/frontend` importing a runtime value (rather than a `type`) from `@12-apps/payments-backend`, including default, namespace, side-effect, re-export and dynamic forms |

The provider names are **derived** from `providerCatalog` in
`backend/src/providers/catalog.ts` rather than retyped in the config, so the
fifth adapter is covered the day it is registered; the config throws outright
if that scrape ever comes back empty. Vendor aliases the registry cannot know
about (`pagseguro`, PagBank's pre-2019 name, still the spelling in its API
hosts and webhook paths) are one documented map beside it.

`pnpm quality:portability:selftest` runs first, and is the reason to believe any
of this. A scoped gate has one silent failure mode — a `files:` glob that stops
matching keeps the gate exiting 0 while it covers nothing — so each rule ships
with a fixture that violates it and one that does the same job correctly
(`scripts/payments-portability-fixtures/`), linted through the real config under
a pretend path inside the package the rule is scoped to. A violation coming back
clean fails CI.

The remaining bullets above (no ORM in core, `fetch`-only adapters, atomic
`setActiveProvider`) are still review items — they are about what the code
*means*, not what it names.
