# Connecting providers by OAuth

Two ways a merchant connects a provider, both supported by the package and
selected per adapter via `authMode`:

| `authMode` | merchant experience | what is stored |
| --- | --- | --- |
| `credentials` | pastes API keys into a form | the keys, encrypted, per environment |
| `oauth` | clicks **Connect**, authorizes on the provider's site | access/refresh tokens + `expiresAt` |

OAuth is the lower-friction path — your client never copies a secret, and
you never hold one they could leak. It is also the only way Stripe Connect
works for tenant accounts.

## What the package already does

- `ProviderDescriptor.authMode` — drives the settings UI. `PaymentProviderSettings`
  renders `ProviderConnection` (connect / reconnect / disconnect card) for
  `oauth`, and the credential form for `credentials`.
- `OAuthConnectService` — `begin` → `complete` → `refresh` → `disconnect`,
  storing tokens through the same encrypted `ProviderConfigStore` the
  credential flow uses.
- `PaymentProviderConfig.expiresAt` — a real, indexed column (not a key in
  the encrypted blob) so a background job can query *which connections
  expire soon*.
- `RECONNECT_REQUIRED` status — distinct from `FAILED` because the remedy
  differs: reauthorize (a button) vs. fix a credential (a form).
- **A dead grant does not receive checkouts.** The routing chain (both the
  settings view's `providerChain` and the gateway's `credentialStoreFrom`
  bridge) excludes `RECONNECT_REQUIRED` rows even though they stay `enabled`:
  a healthy second provider becomes the active one, and a store whose only
  provider lost its grant collapses to the empty chain — the storefront's
  "payments unavailable" state — instead of failing every charge against a
  token the provider already refused. `getCredentials` refuses such a row too
  (direct charges included), while `getConnectedCredentials` still resolves it,
  so webhooks about money that already moved keep authenticating. Because
  `enabled` is never touched, a successful reconnect (`complete` →
  `VERIFIED`) puts the provider straight back into rotation with no manual
  re-activation.
- HTTP endpoints: `POST …/oauth/begin`, `…/oauth/complete`, `…/oauth/disconnect`.

## What YOU still have to build

The package deliberately does not own these — they are host concerns:

1. **CSRF state.** Mint a random `state`, store it against the admin's
   session, and compare it on the callback. `prepareConnect` (frontend prop)
   and the `state` argument are the seams. Never accept a callback whose
   state you did not issue.
2. **The callback route.** `GET /api/payments/oauth/callback/[provider]` —
   validate `state`, then call `completeOAuth` with the `code`.
3. **Platform application credentials.** `client_id` / `client_secret` are
   *yours*, shared across all merchants — supply them via the
   `OAuthAppCredentialsResolver`, from env or config. They are deliberately
   NOT stored per-merchant.

   This app's resolver (`apps/web/lib/payments/gateway.ts`) builds the variable
   names from the provider, so **the suffix is the environment**:

   | variable | environment |
   | --- | --- |
   | `PAGBANK_OAUTH_CLIENT_ID` / `_CLIENT_SECRET` | SANDBOX (unsuffixed) |
   | `PAGBANK_OAUTH_CLIENT_ID_PROD` / `_CLIENT_SECRET_PROD` | PRODUCTION |

   A provider issues a separate application per environment, so each secret
   must travel with its own id — half a swap is as broken as a whole one. The
   pair is resolved strictly: a missing `_PROD` id/secret hides Connect for
   production rather than falling back to the sandbox application and storing
   a test grant as a live one. Full notes in `.env.example`.
4. **The refresh sweep.** A cron that selects connections where `expires_at`
   is near and calls `refresh`. Without it, tokens lapse and merchants land
   in `RECONNECT_REQUIRED`.
5. **The per-provider `oauth` adapter block** — the four functions below.

## Per-provider references

Each adapter needs `buildAuthorizeUrl`, `exchangeCode`, `refresh` and
(optionally) `revoke`. What to look up for each vendor:

### Stripe — Connect
The best-documented of the four, and the model the contract is shaped
around. Look for the OAuth reference (authorize endpoint, `/v1/oauth/token`,
`stripe_user_id`) and decide between **Standard** (merchant keeps their own
Stripe account and dashboard — closest to "my customers use their own
account") and **Express**. Charges for a connected account are then made
with the `Stripe-Account` header, which maps onto the `connectedAccountId`
slot already in the Stripe adapter's credential schema.
- Connect docs: <https://docs.stripe.com/connect>
- OAuth reference: <https://docs.stripe.com/connect/oauth-reference>
- Standard accounts: <https://docs.stripe.com/connect/standard-accounts>

### PagBank / PagSeguro — Connect
Implemented in `providers/pagbank-oauth.ts`. Two things about PagBank differ
from the OAuth2 defaults and will silently break the flow if "corrected":

1. **The application is created by API, not in a dashboard.**
   `POST /oauth2/application` with your ACCOUNT bearer token returns
   `client_id` + `client_secret` together. `redirect_uri` is a SINGLE string
   fixed at creation — which is why the host's callback URL carries no tenant
   (one application cannot hold a URL per store).
2. **The token endpoint does not use HTTP Basic auth.** `POST /oauth2/token`
   takes `X_CLIENT_ID` / `X_CLIENT_SECRET` headers and a **JSON** body. Sending
   `Authorization: Basic` with a form-encoded body fails the exchange with a
   generic error that reaches the merchant only as a dead callback.
3. **`/oauth2/authorize` validates the `client_id` and nothing else.** A wrong
   id redirects to `connect-web.pagbank.com.br/error`; a *correct* one
   redirects to the `acesso.pagbank.com.br` login regardless of what
   `redirect_uri` says — a bogus one, or none at all, is accepted just the
   same. So reaching the login screen proves only that the id belongs to that
   host, and the URI that actually governs the return trip is the single one
   **registered on the application**. Verify it directly rather than inferring
   it from a successful consent screen:

   ```bash
   curl -sS https://api.pagseguro.com/oauth2/application/$CLIENT_ID \
     -H "Authorization: Bearer $PAGBANK_TOKEN"   # account token, not the app secret
   ```

   Its `redirect_uri` must equal `connectRedirectUri()` byte for byte —
   `https://<SITE_DOMAIN>/api/payments/oauth/callback/pagbank`. A mismatch
   cannot surface before consent; it lands as `connectError=exchange_failed`,
   or as a return trip to somebody else's URL.

   The same one-sidedness makes each id's environment testable without any
   secret: request `/oauth2/authorize` for the id on both consent hosts, and
   the one that answers with a login instead of `/error` is its environment.

Scopes are requested at authorize time (never declared on the application) and
joined with `+`: `payments.read`, `payments.create`, `payments.refund`,
`accounts.read`. Authorization codes are single-use and expire in 10 minutes,
and access tokens expire — so the refresh sweep below is not optional here.
- Connect authorization: <https://developer.pagbank.com.br/docs/connect-authorization>
- Create application: <https://developer.pagbank.com.br/reference/criar-aplicacao>
- Query application (check the registered `redirect_uri`):
  <https://developer.pagbank.com.br/reference/consultar-aplicacao>

The five pre-implementation questions about Connect (the FUT-298 spike:
homologação umbrella, webhook signing token, notification-URL scope, token
lifetime, `client_secret` issuance) are answered as far as shipped code can
answer them in [the dedicated section below](#pagbank-connect--the-fut-298-spike-questions).

### Stone — via Pagar.me
Stone's modern API surface is Pagar.me. Check whether your contract offers a
marketplace/partner OAuth model or expects per-merchant API keys — if it is
keys-only, leave the adapter on `authMode: 'credentials'`; the package
supports both and nothing else changes.
- Pagar.me docs: <https://docs.pagar.me/>

### InfinitePay
The public developer surface is checkout-link oriented; confirm with your
account manager whether a partner/OAuth connection exists for your account
tier before building this branch.
- Developers: <https://developers.infinitepay.io/>

> These are documentation entry points, not deep links — vendor doc URLs move
> often. Search within each portal for "OAuth", "Connect", or "partner
> integration". Where a vendor turns out not to offer OAuth, leaving that
> adapter on `credentials` is a supported outcome, not a workaround.

## PagBank Connect — the FUT-298 spike questions

FUT-298 asked five questions about the Connect application model that were
supposed to be answered *before* the Connect code was written. The code shipped
first (FUT-297), and in doing so settled most of them empirically — the adapter
(`backend/src/providers/pagbank-oauth.ts`) and its suite
(`backend/src/__tests__/pagbank-oauth.test.ts`) encode what PagBank actually
accepted on the wire, not what its docs promise. This section is the written
deliverable the spike still owed: per question, what the shipped code
establishes, and what only PagBank's written confirmation can close.

Where an answer is marked **open**, the channel is the SIP support request
tracked in **FUT-476** — *SIP, Suporte Integração PagBank* (Pipefy form
`sBlh9Nq6`), submitted 2026-07-30 with services *API Connect* and *API de
Pedidos e Pagamentos (ORDER)*. Vendor answers land on that ticket first; update
this section when they do.

| # | question | status |
| --- | --- | --- |
| 1 | homologação umbrella covers connected sellers? | **open** — asked via SIP (FUT-476) |
| 2 | which token signs Connect webhooks? | **hypothesis in code** — unconfirmed |
| 3 | notification URLs: application-level or per-seller? | **per-order URLs work**; takeover unconfirmed |
| 4 | `access_token` lifetime | **mechanics settled**; the number is unmeasured |
| 5 | how `client_secret` is issued | **answered** empirically |

### 1. Does the platform homologação umbrella cover connected sellers?

**Open — no code can settle this; it is a commercial/process question.**

What is known:

- PagBank's `docs/solicitar-homologacao` makes homologação mandatory for every
  integrating client *"com exceção daqueles que usam plataformas de e-commerce
  ou módulos"*. Read literally, sellers on a platform are exempt and the
  platform homologates once — which would take a connected store's onboarding
  from a ~4-business-day Pipefy SLA to the minutes the OAuth consent takes.
  That reading is an inference from the doc, not a confirmation.
- One empirical data point cuts the other way, or at least proves that a
  granted OAuth token is not by itself production access: a Connect application
  that passes `/oauth2/authorize` and `/oauth2/token` can still have a
  production `POST /orders` refused with `403 ACCESS_DENIED — whitelist access
  required. Contact PagSeguro`. That code appears in neither the Order error
  table nor the Connect one (the Connect table is transcribed in
  `backend/src/providers/pagbank-connect-errors.ts`; `ACCESS_DENIED` is absent).
  So *something* beyond the grant gates real charges, and whether the
  platform's homologação lifts that gate for every connected seller is exactly
  the open question.

Until PagBank answers (FUT-476 carries the precise questions), do not build
onboarding copy or promises on the exemption.

### 2. Which token signs webhooks for a Connect-connected seller?

**Unconfirmed — the code ships a deliberate, swappable hypothesis.**

The documented baseline (`confirmar-autenticidade-da-notificacao`) is
`x-authenticity-token = SHA-256("{account token}-{payload}")`, signed with the
seller's own account token. The adapter implements exactly that check —
`webhook.verify` in `backend/src/providers/pagbank.ts` compares the header
against ``sha256Hex(`${secret}-${rawBody}`)`` where `secret` is the stored
`webhookToken` field, fail-closed when the header is missing (sandbox stub mode
excepted).

Under Connect we never hold the seller's account token — the exchange returns
an `access_token`/`refresh_token` pair. The hypothesis encoded in the adapter
(`toTokens`, `pagbank-oauth.ts`) is that Connect deliveries are signed with a
**platform-side** secret: on exchange it copies the platform application's
`webhookToken` field onto the connected store's row, so verification reads the
platform value. The hypothesis is deliberately not hard-wired:

- The reference host resolver feeds that field from `PAGBANK_WEBHOOK_TOKEN`,
  and its `.env.example` says to leave it **unset** until PagBank confirms the
  signer — setting it *replaces* the fallback, it does not supplement it.
- With no `webhookToken` stored, the reference host falls back to the stored
  `token` — which for a Connect store is the access token itself, another
  candidate signer.

Candidate signers, none confirmed: the seller's account token (never held under
Connect), the `access_token`, the platform's own account token, the
`client_secret`. Whichever PagBank names slots into the stored `webhookToken`
field without an adapter change. Until then, treat webhook verification for a
connected store as unproven: confirm with a real sandbox delivery before
relying on it, and keep the answer's arrival tracked on FUT-476.

### 3. Are notification URLs application-level or per-seller under Connect?

**Per-order URLs are established; an application-level takeover is not.**

What the code establishes:

- Per-order `notification_urls` continue to be sent with a Connect token —
  `pixPayload`/`cardPayload` in `backend/src/providers/pagbank.ts` include them
  unconditionally, and those request shapes are the ones proven against
  PagBank, not guesses.
- The URL a connected store announces is the **platform's** endpoint: `toTokens`
  copies the application's `notificationUrl` field onto the store's row at
  exchange time, because a connected store never registers a URL of its own.

What is not established: whether an application-registered notification URL
exists under Connect that also (or instead) receives deliveries. Until PagBank
confirms one, per-seller URL registration flows for pasted-token stores cannot
be retired on the strength of Connect.

Adjacent and *definitely* application-level: the public-key (Connect
challenge) URL is registered against the application — the whole `4101x`
Connect error family is about it (`pagbank-connect-errors.ts`), and nothing
else in the system would ever say so.

### 4. What is the `access_token` lifetime?

**The mechanics are settled by code; the concrete number is still unmeasured.**

Established empirically:

- The token endpoint returns `expires_in`, captured into `expiresAt`
  (`toTokens`, `pagbank-oauth.ts`) — so tokens do expire, and the host's sweep
  sizes itself off the stored column (`listExpiring`, pinned by
  `backend/src/__tests__/expiring-connections.test.ts`), never off a hardcoded
  lifetime. The design does not need the number to be known.
- Renewal lives at its **own endpoint**, `/oauth2/refresh` — sending
  `grant_type=refresh_token` to `/oauth2/token` answers `41005
  unsupported_grant_type`, which reads as "refresh unsupported" and means the
  opposite (see the `refresh` doc comment in `pagbank-oauth.ts`).
- Every renewal **rotates** the refresh token and invalidates the spent one
  immediately; a renewal response without a new refresh token therefore leaves
  a dead connection, and the adapter fails it loudly rather than letting it
  look healthy until the next sweep.

Still owed: one measured sandbox authorization with the `expires_in` value
recorded here. Nothing in either repo records the actual number, and PagBank
does not document it. When it is measured (or PagBank answers in writing via
FUT-476), write the value — and the date it was observed — into this section.

### 5. How is `client_secret` issued?

**Answered empirically.** The docs describe the `POST /oauth2/application`
response as `client_id` + `account_id` and never say where `client_secret`
comes from. In practice the creation response carries `client_id` **and**
`client_secret` together — there is no dashboard and no second issuance step
(see item 1 of the PagBank notes above, and the runbook comments in the
reference host's `.env.example`). The create call authenticates with the
partner's ACCOUNT bearer token, and the same trio — `X_CLIENT_ID` /
`X_CLIENT_SECRET` headers plus that account-token `Authorization: Bearer` —
then authenticates every token-endpoint call (`connectHeaders` in
`pagbank-oauth.ts`, including the `401 41008 invalid_token` trap when the
Bearer is missing).

Consequence: the secret exists only where the creation response was captured.
Whether `GET /oauth2/application/{client_id}` re-discloses it is unverified —
treat the create response as the only copy, and put it (with the account token
that created it) straight into the platform's secret manager.

## Security checklist

- Always compare the callback `state` against the one you issued.
- Register exact redirect URIs at the provider; never accept one from a
  request parameter.
- Treat refresh tokens like passwords — they live in the encrypted blob and
  must never be returned to the browser (`completeOAuth` echoes only status
  and expiry).
- Run authorization in a top-level window, never an iframe.
- On `revoke`, disconnect locally even if the provider call fails, so a
  merchant is never stuck with a connection they cannot remove.
