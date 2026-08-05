# Payments platform (`packages/payments/*`)

A portable, vendor-agnostic payments platform, self-contained in this folder
and split along the server/browser boundary into two workspace packages —
deliberately shaped so it can later become a standalone application
(payments microservice + microfrontend) without restructuring:

| package                   | contents |
| ------------------------- | -------- |
| `@12-apps/payments-backend`  | normalized charge/refund/webhook domain, per-provider adapters (Stone, InfinitePay, Stripe), the gateway, merchant-scoped credential settings (masking, verify, single active provider), fetch-native HTTP handlers, storage ports with in-memory + Prisma implementations, and the OWNED Prisma schema fragment + migration |
| `@12-apps/payments-frontend` | plug-and-play MUI components for the payment surfaces — `PaymentProviderSettings` (per-provider config page), `CheckoutPayment` (buyer payment step) and `CheckoutFlow` (the FULL three-step buyer checkout, host-composed through ports + design-system slots; see `ADOPTING.md` §3) — plus the headless hooks/clients they build on |

Everything payment-related lives here: code, HTTP surface, UI, database
schema, and migration. Hosts mount it; they don't re-implement any of it.

## Why it is agnostic (the five seams)

1. **Adapter contract** (`PaymentProviderAdapter`) — every provider implements
   `createCharge` / `getCharge` / `refund` / `verifyCredentials` /
   `webhook.verify`+`parse` / `clientConfig`. Provider vocabulary never
   escapes the adapter; a new vendor is one adapter + one registry entry.
2. **Normalized domain** — one `ChargeStatus` lifecycle, one `DeclineReason`
   taxonomy, integer-cents `Money`, and a capability matrix that gates
   operations before adapters are called.
3. **Storage ports** (`CredentialStore`, `ChargeStore`, `WebhookInbox`,
   `ProviderConfigStore`) — the package is database-free at its core; this
   repo wires the provided Prisma adapters, tests wire memory.
4. **Client tokenization abstraction** — `PUBLIC_KEY` (in-page encryption),
   `SDK` (Stripe.js-style), `REDIRECT` (hosted checkout), `NONE` — the real
   frontend difference between vendors, switched on by the components.
5. **Merchant scoping** (`MerchantRef`: `PLATFORM` | `TENANT`) — the platform
   charging its tenants and each tenant charging its own buyers share one
   code path; credentials resolve per merchant.

## Backend quick start

```ts
import {
  createPaymentsGateway, createPaymentsHttp, createSettingsService,
  credentialStoreFrom, defineProviders,
  createPrismaChargeStore, createPrismaProviderConfigStore, createPrismaWebhookInbox,
} from '@12-apps/payments-backend';
import { stoneProvider } from '@12-apps/payments-backend/providers/stone';
import { infinitePayProvider } from '@12-apps/payments-backend/providers/infinitepay';
import { stripeProvider } from '@12-apps/payments-backend/providers/stripe';

const providers = defineProviders({
  stone: stoneProvider(), infinitepay: infinitePayProvider(), stripe: stripeProvider(),
} as const);
// $transaction is REQUIRED — the active-provider switch must be atomic.
const configStore = createPrismaProviderConfigStore(
  prisma.paymentProviderConfig, cipher, prisma.$transaction,
);
// allowStubMode defaults to FALSE — never enable it in production.
const settings = createSettingsService(providers, configStore);
const gateway = createPaymentsGateway({
  providers,
  credentials: credentialStoreFrom(configStore),
  charges: createPrismaChargeStore(prisma.paymentCharge),
  webhooks: createPrismaWebhookInbox(prisma.paymentWebhookEvent),
  onWebhookEvent: async (event, charge) => { /* mark order paid, notify, ... */ },
});
export const paymentsHttp = createPaymentsHttp({
  gateway, settings, charges,
  // REQUIRED: the buyer never chooses the price. Look the order up
  // server-side and return the amount YOU computed.
  resolveChargeRequest: async (merchant, draft) => {
    const order = await loadOrder(merchant, draft.orderRef);
    return {
      reference: order.id,
      amount: { amountCents: order.totalCents, currency: 'BRL' },
      method: draft.method,
      customer: { ...order.customer, ...draft.customer },
      card: draft.card,
    };
  },
});
```

The HTTP handlers are WHATWG `Request → Response` functions — mount them in
Next.js route handlers today; run them as a standalone service later. The
HOST owns auth and merchant attribution (it passes `{ merchant }` per call).

## Frontend quick start

```tsx
import {
  PaymentsProvider, createPaymentsClient, createPaymentsSettingsClient,
  CheckoutPayment, PaymentProviderSettings,
} from '@12-apps/payments-frontend';

// Settings page (admin):
<PaymentProviderSettings client={createPaymentsSettingsClient({ baseUrl: '/api/payments' })} />

// Checkout page (buyer):
<PaymentsProvider client={createPaymentsClient({ baseUrl: '/api/payments' })}>
  <CheckoutPayment
    reference={order.id}
    amount={{ amountCents: total, currency: 'BRL' }}
    customer={{ name, email, taxId }}
    tokenizeCard={tokenizeForProvider} // host-injected per-provider tokenizer
    onPaid={(charge) => confirmOrder(charge)}
  />
</PaymentsProvider>
```

Both components are theme-inheriting MUI; hosts that want their own pixels
use the exported headless hooks (`useCreateCharge`, `useChargeStatus`) and
clients instead.

## Database (self-contained)

`backend/prisma/payments.prisma` and `backend/prisma/migrations/` are OWNED
by `@12-apps/payments-backend`: three FK-free tables scoped by
`(merchant_kind, merchant_id)` — provider configs (encrypted credential
blob), charges (idempotency uniques), webhook inbox (dedup triple). The
host's prisma folders hold only SYMLINKS to these files (Prisma has no
cross-package import; a committed symlink is the equivalent, and Prisma
reads straight through it) — no payment model or migration ever lives in
the application. `pnpm --filter @12-apps/payments-backend prisma:sync`
creates/repairs the links; `prisma:sync:check` is the CI drift gate.

## Guarantees the gateway owns

- Charge idempotency: merchant-scoped keys, same-process single-flight,
  atomic `(merchant, idempotencyKey)` uniqueness at the store, and the key
  forwarded to providers with native idempotency.
- Webhook idempotency: inbox dedup on `(merchant, provider, eventId)`.
- Forward-only status: no regressions, no contradictory terminal overwrites.
- Fail-closed webhooks: live merchants without a webhook secret reject every
  delivery; only stub mode may skip verification.
- Charge identity never crosses merchants (create conflicts throw; upserts
  are ownership-scoped).
- **Money is server-authoritative**: the browser sends a draft carrying a
  method and payment instruments — never `amount` or `reference`. The host's
  required `resolveChargeRequest` derives those from its own records, so a
  tampered client cannot underpay or attach a payment to another order.
- **Stub mode can never reach production**: it is a construction-time option
  (`allowStubMode`, default off), applies only to SANDBOX configs, is absent
  from the settings payload type, and is stripped again on the credential
  read path. A PRODUCTION merchant cannot be made to report fake payments.
- **One active provider, enforced end to end**: `ProviderConfigStore`
  requires an atomic `setActiveProvider` (no sequential fallback exists),
  the Prisma adapter implements it in a transaction, and a partial unique
  index allows at most one enabled config per merchant — so a racing enable
  fails loudly instead of leaving two providers live, and a failed write
  cannot silently take checkout offline by leaving none.

## Connecting providers

Adapters declare `authMode`: `credentials` (paste API keys — the current
default for all four) or `oauth` (merchant clicks Connect and authorizes on
the provider's site). The settings UI switches between a credential form and
a connection card automatically; tokens carry a queryable `expiresAt` and a
dedicated `RECONNECT_REQUIRED` state so lapsed authorizations prompt a
reconnect rather than looking like bad credentials.

See `OAUTH.md` for the flow, what the host must build, and the per-vendor
documentation links.

See `ADOPTING.md` for wiring, the PagBank migration path, and completing a
live adapter.
