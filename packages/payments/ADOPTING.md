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
  local dev and demo tenants. Even when on it applies only to SANDBOX
  configs; PRODUCTION can never run stub charges.

Mount the handlers behind the host's auth. Suggested Next.js layout:

| route | handler | merchant attribution |
| ----- | ------- | -------------------- |
| `GET  /api/payments/config` | `getClientConfig` | tenant in scope (buyer session) |
| `POST /api/payments/charges` | `createCharge` | tenant in scope |
| `GET  /api/payments/charges/[provider]/[id]` | `getCharge` | tenant in scope |
| `POST /api/payments/webhooks/[provider]/[connectKey]` | `handleWebhook` | connect key → merchant (same pattern as the PagBank webhook route); pass the RAW body |
| `GET  /api/payments/settings` | `getSettings` | admin session → their tenant |
| `PUT  /api/payments/settings/providers/[provider]` | `saveCredentials` | admin session |
| `PUT  /api/payments/settings/providers/[provider]/enabled` | `setEnabled` | admin session |
| `POST /api/payments/settings/providers/[provider]/verify` | `verify` | admin session |
| `GET  /api/payments/settings/providers/[provider]/setup-guide` | `getSetupGuide` | admin session (host supplies `setupContextFor` with per-merchant webhook URLs) |
| `POST /api/payments/settings/providers/[provider]/oauth/begin` | `beginOAuth` | admin session; host mints + persists the CSRF `state` first |
| `POST /api/payments/settings/providers/[provider]/oauth/complete` | `completeOAuth` | admin session; call from your callback route AFTER validating `state` |
| `POST /api/payments/settings/providers/[provider]/oauth/disconnect` | `disconnectOAuth` | admin session |

OAuth-mode providers need three more host pieces — the CSRF state, the
callback route, and a refresh sweep over `expires_at`. See `OAUTH.md`, which
also lists the per-vendor documentation to consult.

For platform-charges-tenants billing, mount the same handlers under a
platform-admin route with `{ merchant: { kind: 'PLATFORM', id: 'platform' } }`.

Domain reactions (mark order paid, notifications, rollups, audit) live in
`onWebhookEvent` — the library stays domain-free.

## 3. Frontend wiring

- Settings page: render `<PaymentProviderSettings client={...} />` where the
  provider config screen lives today. It renders every registered provider
  from its credential schema — adding a vendor changes NOTHING here.
- Checkout page: render `<CheckoutPayment ... />` inside a
  `<PaymentsProvider>`. Inject `tokenizeCard` per the active provider's
  `tokenization` (`SDK` → load the provider's JS SDK; `PUBLIC_KEY` → encrypt
  with `config.publicKey`; `REDIRECT`/PIX flows need no tokenizer).

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
