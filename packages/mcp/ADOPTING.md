# Adopting @12-apps/mcp

A **plug-and-play MCP plugin** (12-23): the tool surface, the authorization server
that protects it, the models both need, and the two CI gates that keep the
advertised surface honest. A host repo only *points* at these surfaces; when the
library updates, every host updates with **no app changes**. Same contract
`@12-apps/report-builder` and `@12-apps/rbac` established.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core** | `@12-apps/mcp` | `generateTools(openapi)`, `createToolRegistry`, `dispatchTool` (bearer passthrough), `buildManifest`, the surface lock, and both discovery-document builders. |
| **OAuth AS** | `@12-apps/mcp/oauth` | `createApiMcpOauth({ stores, resolveSession })` → `routes` + named `handlers` + `verifyBearer`. register / authorize / token, the JWKS, and both `.well-known` documents, with PKCE, stateless codes, hashed rotating refresh tokens and replay revocation inside. |
| **Hono** | `@12-apps/mcp/hono` | `const oauth = mcpOauthRouter({ … }); app.route('/', oauth.router)` — at the ORIGIN ROOT (see rule 2). `hono` is an OPTIONAL peer. |
| **React** | `@12-apps/mcp/react` | The AI-connect onboarding UI and status board (pt-BR, overridable). |
| **`mcp:generate` / `mcp:check`** | `@12-apps/mcp/generate` | Your script becomes `mcpGenerateCli({ document, version, source, versionLocation, outputs, check })`. `12-apps/ci`'s `mcp-contract.yml` shells out to your `mcp:check` package script and keeps working unchanged. |
| **`mcp:coverage`** | `@12-apps/mcp/coverage` | `mcpCoverageCli({ appDir, endpoints, exclusionsPath, actionMapPath })` — the route/action completeness gate. |
| **Prisma** | `prisma/mcp.prisma` + `prisma/migrations/*` | `pnpm --filter @12-apps/mcp prisma:sync -- <host schema dir>`: the partial is **COPIED** into the host's multi-file schema folder — never symlinked (a symlinked migration is silently skipped by Prisma; a symlinked partial dangles under `turbo prune`). |

## Host wiring rules (the ones that bite)

1. **The host answers WHO; the package answers WHAT THEY MAY HAVE.**
   `resolveSession` reads the host's cookie session and returns
   `{ subject, email }` — or `null`, which redirects the caller into the host's
   sign-in flow with a callback back to the authorize URL. **Identity never comes
   from a query parameter**, so a client cannot name the user it wants a token for.
2. **Mount at the origin root.** Two of the six paths are `.well-known` documents
   and a connector reads them from the origin, not from a prefix — the descriptors
   therefore carry absolute paths. `paths` moves any of them, and the RFC 8414
   document is built from the RESOLVED paths, so a document that lies about a path
   (a flow that fails at the first hop) is not expressible.
3. **The gate is an operator decision, and 404 is the disabled answer.** With
   `enabled: false` authorize/token/jwks/discovery answer **404** — a probe cannot
   tell a disabled AS from an app that has none — while registration answers
   **403 `access_denied`**, because RFC 7591 has a code for "the endpoint is here,
   registration is closed". future-pay passes
   `enabled: () => process.env.MCP_BEARER_ENABLED === 'true'`, so the surface stays
   OFF until an operator opts in.
4. **No signing key, no tokens.** `signingKey` defaults to the env-backed provider
   (`MCP_OAUTH_SIGNING_KEY` + `MCP_OAUTH_SIGNING_KEY_ID`, PKCS#8 PEM, ES256).
   Returning `null` is a *safe-by-default* state, not an error: authorize
   `server_error`s, token issuance refuses, and the JWKS answers **503** rather
   than an empty key set a client would mistake for a usable one. Rotation is by
   `kid` — publish old + new during the overlap window.
5. **`trustedOrigins` is REQUIRED behind a reverse proxy.** The server sees only
   its internal bind on `request.url`, so the public origin comes from
   `X-Forwarded-Host` — honoured **only** when it is on this allowlist; anything
   else (spoofed, foreign, absent) resolves to the FIRST entry. With no allowlist a
   forwarded host is never trusted at all, so a proxied deployment fails closed to
   the internal origin rather than to an attacker's. Issuance and verification read
   the same resolver from the same request, which is what stops "minted for A,
   verified against B" from rejecting valid tokens.
   `trustedOriginsFromEnv('MCP_OAUTH_TRUSTED_ORIGINS')` keeps future-pay's wiring.
6. **The stores are narrow ports; Prisma fills them in one line.**
   `createPrismaMcpStores(async () => prisma as unknown as McpOauthPrisma)`. A
   non-Prisma host implements `OAuthClientStore` / `RefreshTokenStore` /
   `McpConnectionStore` directly — the shapes are CLOSED and documented in
   `src/oauth/stores.ts`, and the harness fills exactly them with SQL.
7. **`rotate` must be atomic.** The port's contract is "store the successor AND
   revoke its parent, or neither": a crash between the two leaves two usable
   tokens where rotation promises one. The Prisma adapter uses `$transaction`.
8. **Single-use codes are only as strong as the replay store.** The default
   remembers redeemed `jti`s IN THIS PROCESS, which is exact on one instance and
   best-effort across several — a code could be replayed against a pod that has not
   seen the `jti`, inside the ≤60s code lifetime. **Before running on more than one
   instance, pass a shared atomic `codeReplay`** (a short-TTL row with a unique
   constraint, or a distributed cache). The port exists so that is config, not a
   patch to the grant handler.
9. **Connections are per USER, not per tenant** — an MCP bearer is
   auth-passthrough. `connections.resolveUserId(email)` maps the token's email to
   the host's user id (future-pay resolves it by email because `session.user.id` is
   the OAuth `sub`); returning `null` records nothing. Recording is best-effort and
   FENCED: a failing directory can never turn a valid grant into a 500, and nothing
   about the attempt is logged, because the only values in hand are an email and a
   client id.
10. **Disconnecting means BOTH halves.** `connections.revokeByHost(...)` returns the
    OAuth client ids it revoked, and the caller must then
    `refreshTokens.revokeLiveForClient(email, clientId)` for each — a host holding a
    live refresh token simply rotates its way back in and the card lights green on
    the next grant. Neither half invalidates an outstanding ACCESS token: those are
    self-contained JWTs, so a disconnected host keeps working for at most their
    15-minute TTL and can then obtain nothing further.
11. **These bodies are NOT the `{ data }` envelope.** A 302 with a `Location`, RFC
    6749 §5.1/§5.2 JSON, an RFC 8414/9728 document — every shape here is fixed by
    specification, and `Cache-Control: no-store` is on every credential-bearing
    response. Wrapping any of it would break every client. That is why the adapters
    are one line and hand the `Response` straight back.

## The config, field by field

| Field | Required | Default | Notes |
|---|---|---|---|
| `stores` | yes | — | `clients` + `refreshTokens` (+ optional `connections`) |
| `resolveSession` | yes | — | `{ subject, email }` or `null` → sign-in redirect |
| `enabled` | no | `true` | `false` ⇒ 404 everywhere, 403 on register |
| `signingKey` | no | env provider | `null` ⇒ mints nothing, JWKS 503 |
| `trustedOrigins` | no | `[]` (never trust a forwarded host) | REQUIRED behind a proxy |
| `scopes` | no | `mcp:read mcp:write` | advertised AND validated against |
| `resourcePath` | no | `/api/mcp` | the access token's `aud` |
| `paths` | no | `/api/oauth/*` + `/.well-known/*` | also rewrites the discovery document |
| `loginPath` / `loginCallbackParam` | no | `/login` / `callbackUrl` | Auth.js's names |
| `accessTokenTtlSeconds` | no | 900 | 15 minutes |
| `refreshTokenTtlMs` | no | 30 days | |
| `codeReplay` | no | in-process | see rule 8 |
| `connections` | no | — | `resolveUserId`, `providerRules`, `activityThrottleMs` |

## The endpoints

| Method | Path (default) | Answers |
|---|---|---|
| GET | `/.well-known/oauth-authorization-server` | RFC 8414 metadata, built from the resolved paths |
| GET | `/.well-known/oauth-protected-resource` | RFC 9728 metadata (same origin + scope source) |
| GET | `/.well-known/jwks.json` | the public JWK (503 while unprovisioned), `max-age=300` |
| GET | `/api/oauth/authorize` | 302 with `code` + `state`; a plain 400 when the client/`redirect_uri` is unregistered — **never** an error redirect to an unvalidated URI |
| POST | `/api/oauth/token` | `authorization_code` (single-use, PKCE-verified, bound `redirect_uri`) and `refresh_token` (rotated, client-bound, narrow-only scope) |
| POST | `/api/oauth/register` | 201 RFC 7591 client information; the secret exactly once, hashed at rest |

## Minimal host (Hono)

```ts
import { mcpOauthRouter } from '@12-apps/mcp/hono';
import { createPrismaMcpStores, trustedOriginsFromEnv, type McpOauthPrisma } from '@12-apps/mcp/oauth';

const oauth = mcpOauthRouter({
  stores: createPrismaMcpStores(async () => (await getPrismaClient()) as unknown as McpOauthPrisma),
  enabled: () => process.env.MCP_BEARER_ENABLED === 'true',
  trustedOrigins: trustedOriginsFromEnv('MCP_OAUTH_TRUSTED_ORIGINS'),
  resolveSession: async (request) => {
    const session = await getRequestSession(request);
    const email = session?.user?.email;
    return email ? { subject: session.user.id || email, email } : null;
  },
  connections: { resolveUserId: async (email) => (await getUserByEmail(email))?.id ?? null },
});

app.route('/', oauth.router);
// The resource server's half, on the same key and origin resolution:
const identity = await oauth.verifyBearer(token, request, { requiredScope: 'mcp:write' });
```

## Minimal host (the two gates)

```ts
// scripts/mcp/generate.ts  (mcp:generate / mcp:check)
import { mcpGenerateCli } from '@12-apps/mcp/generate';
mcpGenerateCli({
  document: () => buildOpenApiDocument(),
  version: MCP_SURFACE_VERSION,
  source: 'my app',
  versionLocation: 'lib/mcp/surface-version.ts',
  outputs: { openapi: …, manifest: …, surfaceLock: … },
  extraArtifacts: [{ path: submissionPath, render: renderSubmission }],
  check: process.argv.includes('--check'),
});

// scripts/mcp/coverage.ts  (mcp:coverage)
import { mcpCoverageCli } from '@12-apps/mcp/coverage';
mcpCoverageCli({ appDir, webRoot, endpoints, exclusionsPath, actionMapPath });
```

Two things about the gates worth knowing before you adopt them:

- **The scan root is the whole `app` folder, never `app/api`.** A completeness gate
  rooted below the surface it claims to cover does not fail when it misses
  something — it simply never looks, and three OAuth/JWKS discovery routes shipped
  unregistered for exactly as long as that was true.
- **The filesystem walk is imported from `@12-apps/rbac/coverage`**, not copied.
  Both gates assert completeness over the same two surfaces, and they must not be
  able to disagree about what the surface IS; two copies agree on the day they are
  written and drift silently afterwards, in the direction of not looking.
- `mcp:coverage` reports staleness for ACTION exclusions only, exactly as the host
  gate did. Route-prefix staleness is a follow-up (it would go red on a host's
  committed exclusions file the moment it adopted the package, so it needs its own
  burn-down).

## Phase B — adopting into a host that ALREADY has these tables (future-pay)

**Nothing to baseline.** Every statement in the package migration is guarded
(`CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, `ADD COLUMN
IF NOT EXISTS`, and a conrelid-scoped `DO` block for the CHECK), so applying it to
a host that already has `oauth_clients` / `oauth_refresh_tokens` /
`mcp_connections` changes nothing and exits 0 — no `prisma migrate resolve
--applied` step, and no risk of a green deploy that skipped a schema change.

Deliberate deltas to reconcile:

- **The FK from `mcp_connections.user_id` to `users` is not in the package
  migration** — host vocabulary. future-pay keeps its `ON DELETE CASCADE`.
- **`onboarding_states` is not here.** future-pay's migration created it beside
  `mcp_connections`; it belongs to `@12-apps/onboarding` (12-23).
- The host's `lib/mcp/oauth/**` (~1.5k LOC) and its four route files are replaced
  by the mount plus, where a coverage gate forces the file to exist, a one-line
  `export const GET = mcpOauth.handlers.authorize`.
- `scripts/mcp/generate.ts`, `scripts/mcp/coverage.ts` and
  `scripts/mcp/surface-lock.ts` collapse into the two CLI calls above.

## What deliberately did NOT move into the package

- **The account/connection SCREENS' endpoints** (`GET/DELETE
  /api/account/mcp-connections`) — they mix session resolution, published plugin
  URLs and a logger. The stores they need (`listActive`, `revokeByHost`,
  `revokeLiveForClient`) are all here; the route is a follow-up.
- **The MCP registry itself** — which endpoints become tools, their annotations
  and redactions, is the host's catalogue. The package generates, dispatches and
  gates it.
- **`mcp:lint`, `mcp:parity`, `mcp:smoke`, `mcp:test-coverage`** — the remaining
  future-pay MCP scripts. Only the two the reusable CI workflows shell out to moved
  (12-23's scope).
- **Authorization codes as rows.** They are stateless signed blobs, so there is no
  table and nothing to sweep — only the replay store (rule 8).
