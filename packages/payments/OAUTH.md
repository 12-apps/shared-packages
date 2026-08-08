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
