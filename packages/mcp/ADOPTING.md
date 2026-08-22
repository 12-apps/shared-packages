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
| **React** | `@12-apps/mcp/react` | The AI-connect onboarding UI and status board. Every word is REQUIRED host config — see below. |
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
   registration is closed". The origin host passes
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
   `trustedOriginsFromEnv('MCP_OAUTH_TRUSTED_ORIGINS')` keeps the origin host's wiring.
6. **The stores are narrow ports; Prisma fills them in one line.**
   `createPrismaMcpStores(async () => prisma as unknown as McpOauthPrisma)`. A
   non-Prisma host implements `OAuthClientStore` / `RefreshTokenStore` /
   `McpConnectionStore` directly — the shapes are CLOSED and documented in
   `src/oauth/stores.ts`, and the harness fills exactly them with SQL.
7. **`rotate` must CLAIM the parent, not just revoke it.** The port's contract is
   "revoke the parent CONDITIONALLY on it still being live, require a count of
   exactly 1, and create the successor in the same transaction — otherwise write
   nothing and return `false`". Atomicity alone (both writes or neither) covers a
   crash and NOT a race: with an unconditional `update`, two concurrent rotations of
   one token both succeed, leaving two live successors and replay detection silently
   defeated, because the replay rule waits for a third use of the parent that now
   never comes. That is OAuth 2.1 §4.3.1 bypassed by WINNING a race instead of
   arriving second, which is the whole attack rotation exists to stop. The Prisma
   adapter does it with `updateMany({ where: { tokenHash, revokedAt: null } })`
   inside an interactive `$transaction`; the harness does the same in raw SQL, on
   purpose, as the worked example of a non-Prisma host meeting the contract.
8. **`codeReplay` is REQUIRED, and that is the point.** Single-use codes are only as
   strong as the replay store, and the in-process one remembers redeemed `jti`s IN
   THIS PROCESS: exact on one instance, and on several a code can be replayed
   against a pod that has not seen the `jti`, inside the ≤60s code lifetime. So
   there is no default. Pass a shared atomic store (a short-TTL row with a unique
   constraint, or a distributed cache), or pass the literal `'in-process'` to
   acknowledge the single-instance limit out loud:

   ```ts
   codeReplay: 'in-process',              // one pod, and you have said so
   codeReplay: myRedisSetIfAbsentStore,   // more than one pod
   ```

   Every other default in this config fails CLOSED — no signing key mints nothing
   and answers JWKS 503, `enabled: false` is 404 everywhere, an empty
   `trustedOrigins` never trusts a forwarded host. An in-process default would be
   the only one that fails OPEN, on the very topology a reusable package exists for.
   Scaling out must not be able to weaken the guard by silence.
9. **`authorize` has NO consent screen, so it refuses clients nobody approved.**
   Registration is open whenever `enabled` is true (RFC 7591), and a cookie session
   proves who is asking, never that they AGREED. Without a gate the chain is one
   click: an attacker registers a client carrying their own `redirect_uris` and
   their own `scope`, sends a signed-in admin a link to `authorize`, and the
   endpoint mints them a code — and the two guards that look like they would stop
   it, exact redirect-URI matching and the per-client scope ceiling, are both
   checked against the ATTACKER'S OWN registration. So:

   - pass **`resolveApproval(request, client, scopes)`** — your approval screen or
     policy; returning `false` gives the caller `access_denied`;
   - or list first-party client ids in **`preApprovedClientIds`** if you register
     your own clients and have no screen to show;
   - with neither, every dynamically registered client is refused. That is the
     default, and it is deliberately the inconvenient one.
10. **Connections are per USER, not per tenant** — an MCP bearer is
    auth-passthrough. `connections.resolveUserId(email)` maps the token's email to
    the host's user id (the origin host resolves it by email because `session.user.id` is
    the OAuth `sub`); returning `null` records nothing. Recording is best-effort and
    FENCED: a failing directory can never turn a valid grant into a 500, and nothing
    about the attempt is logged, because the only values in hand are an email and a
    client id.
11. **Disconnecting means BOTH halves — call `disconnectAiHost`, not the stores.**
    `connections.revokeByHost(...)` ends the rows and returns the OAuth client ids
    behind them, and every live refresh token of those clients must be ended in the
    same act — a host holding a live refresh token simply rotates its way back in
    and the card lights green on the next grant. Since 12-48 the rule IS a
    function: `disconnectAiHost(stores, { userId, email }, host)` does both and
    reports what it ended, so a host cannot import one half without the other.
    Neither half invalidates an outstanding ACCESS token: those are
    self-contained JWTs, so a disconnected host keeps working for at most their
    15-minute TTL and can then obtain nothing further.
12. **These bodies are NOT the `{ data }` envelope.** A 302 with a `Location`, RFC
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
| `codeReplay` | **yes** | — (no default, on purpose) | a shared atomic store, or `'in-process'` to acknowledge one pod — rule 8 |
| `resolveApproval` | no | refuse unapproved clients | the consent seam — rule 9 |
| `preApprovedClientIds` | no | `[]` | first-party client ids exempt from the approval gate — rule 9 |
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

## The MCP transport (`/api/mcp`)

`handleMcpJsonRpc` is the JSON-RPC 2.0 request half of the Streamable HTTP
transport: the envelope, the method table (`initialize`, `ping`, `tools/list`,
`tools/call`), the error codes and the notification convention. The host keeps
what is its own — the server's name, its advertised surface version, and the
`instructions` an agent reads on connect:

```ts
import { handleMcpJsonRpc, UNAUTHORIZED_CODE } from '@12-apps/mcp';

const response = await handleMcpJsonRpc(body, registry, auth, {
  serverInfo: { name: 'example-host', version: `${MCP_SURFACE_VERSION}.0.0` },
  instructions: 'Resolve the tenant with `listUserTenants` before acting.',
});
```

Three rules the signature enforces rather than documents:

- **Discovery stays open.** `auth` is `null` when the request carried no valid
  bearer; only `tools/call` refuses, with `UNAUTHORIZED_CODE` (-32001), which the
  host maps to HTTP 401. A client can read the surface before it has a token.
- **`null` means "no reply".** Notifications (`notifications/*`) return `null`,
  and the host must send no body for them.
- **A malformed payload is answered, not thrown.** A `null` batch element or an
  object with no `method` returns -32600, so one bad element cannot 500 the route.

`serverInfo.version` is the ONLY signal a connected client gets that the tool
surface moved — this transport has no server→client stream, so
`capabilities.tools` deliberately does not claim `listChanged`. Pair it with the
surface lock (`mcp:generate`) so forgetting the bump is a build error.

## Redaction: take both halves

A redacted field has to disappear from two places, and they are reached at
different times:

```ts
import { redactResponseSchema, redactResponseBody } from '@12-apps/mcp';

// generate time — what the tool ADVERTISES
schema = redactResponseSchema(responseSchema, paths, operationId);
// dispatch time — what it RETURNS (the registry already does this for you
// from `x-mcp-redact-response`)
body = redactResponseBody(body, paths);
```

Drive both from ONE list — in an OpenAPI-generated surface that list is the
operation's `x-mcp-redact-response`, which `generateTools` carries onto the tool
and the registry applies at dispatch. Take one half only and you get the failure
the pair exists to prevent:

- **body stripped, schema not narrowed** → every successful call returns
  `structuredContent` that fails validation against the schema the manifest
  itself published; worst when the field was `required`.
- **schema narrowed, body not stripped** → the manifest claims the field is gone
  while the value still reaches the agent. The redaction protected nothing.

`redactResponseSchema` **throws** when a path names no field, rather than
returning quietly — a typo'd or stale redaction otherwise protects nothing,
invisibly, which is the one outcome a redaction list must never have. Let it fail
the generator.

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

## Phase B — adopting into a host that ALREADY has these tables (the origin host)

**Nothing to baseline.** Every statement in the package migration is guarded
(`CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, `ADD COLUMN
IF NOT EXISTS`, and a conrelid-scoped `DO` block for the CHECK), so applying it to
a host that already has `oauth_clients` / `oauth_refresh_tokens` /
`mcp_connections` changes nothing and exits 0 — no `prisma migrate resolve
--applied` step, and no risk of a green deploy that skipped a schema change.

Deliberate deltas to reconcile:

- **The FK from `mcp_connections.user_id` to `users` is not in the package
  migration** — host vocabulary. The origin host keeps its `ON DELETE CASCADE`.
- **`onboarding_states` is not here.** The origin host's migration created it beside
  `mcp_connections`; it belongs to `@12-apps/onboarding` (12-23).
- The host's `lib/mcp/oauth/**` (~1.5k LOC) and its four route files are replaced
  by the mount plus, where a coverage gate forces the file to exist, a one-line
  `export const GET = mcpOauth.handlers.authorize`.
- `scripts/mcp/generate.ts`, `scripts/mcp/coverage.ts` and
  `scripts/mcp/surface-lock.ts` collapse into the two CLI calls above.

## What deliberately did NOT move into the package

- **The account/connection SCREENS' route files** (`GET/DELETE
  /api/account/mcp-connections`) — they answer in the HOST's app-wide response
  envelope and mix its session resolution, published plugin URLs and logger, so
  the handler stays host code (unlike the OAuth endpoints, whose shapes are
  fixed by RFC — rule 12 — these are ordinary host API routes). What DID move
  (12-48) is the operations under them: `listAiConnections` (the stored open
  `host` string narrowed to the package's own `AiProvider` union) and
  `disconnectAiHost`, which owns the disconnect's both-halves rule — revoke the
  connection rows AND end every live refresh token of each returned client id in
  one call. A host that imports the disconnect cannot get only half of it; half
  is the failure mode where the assistant rotates its live token and the card
  the user just disconnected lights green again on the next grant (rule 11).
- **The MCP registry itself** — which endpoints become tools, their annotations
  and redactions, is the host's catalogue. The package generates, dispatches and
  gates it.
- **`mcp:lint`, `mcp:parity`, `mcp:smoke`, `mcp:test-coverage`** — the remaining
  the origin host MCP scripts. Only the two the reusable CI workflows shell out to moved
  (12-23's scope).
- **Authorization codes as rows.** They are stateless signed blobs, so there is no
  table and nothing to sweep — only the replay store (rule 8).

## The AI screens take their words (FUT-760)

`@12-apps/mcp/react` used to ship this surface's pt-BR: the walkthrough for each
assistant, the capability cards, the permission reassurance, every step label
and every button. `hosts`, `capabilities` and `permissionModel` were OPTIONAL
props that fell back to it, and `guide.ts` described them as "the shared
defaults" — so a host that configured nothing published one product's
Portuguese, and had no field to decline it.

They are required now, and the retired wording ships as NAMED packs:

```ts
import {
  PT_BR_AI_CAPABILITIES,
  PT_BR_AI_CONNECT_PROMPT,
  PT_BR_AI_HOST_GUIDES,
  PT_BR_AI_PERMISSION_MODEL,
} from "@12-apps/mcp";
import { PT_BR_MCP_AI_COPY } from "@12-apps/mcp/react";

<AiIntegrationOnboarding
  hosts={PT_BR_AI_HOST_GUIDES(platformName)}
  capabilities={PT_BR_AI_CAPABILITIES}
  permissionModel={PT_BR_AI_PERMISSION_MODEL}
  connectPrompt={PT_BR_AI_CONNECT_PROMPT({ announceTool, probeTool, probeSubject, identifierName })}
  copy={PT_BR_MCP_AI_COPY}
  …
/>
```

Nothing changes on screen if you adopt them — they are the same sentences,
now chosen in a diff.

### What moved

- **`aiHostGuides(platformName)` → `PT_BR_AI_HOST_GUIDES(platformName)`**, in
  `@12-apps/mcp` (from `./guide`, which now carries types only). The guides are
  data as much as copy — which assistants are offered, their stage ids and
  brands — and both halves travel together, because a step label and the stage
  it labels are useless apart.
- **`AI_CAPABILITIES` → `PT_BR_AI_CAPABILITIES`**, same move.
- **`AI_PERMISSION_MODEL` → `PT_BR_AI_PERMISSION_MODEL`**. The export left
  behind is now the TYPE `AiPermissionModel`.
- **`aiConnectPrompt(spec)` → `aiConnectPrompt(spec, copy)`**, where `copy` is a
  template. It already took the host's tool NAMES; the words around them are the
  host's too now. `PT_BR_AI_CONNECT_PROMPT` is that template.
- **`platformName` is gone from `<AiIntegrationOnboarding>`.** It existed only
  to build the default guides. The host builds its own now and interpolates its
  own name, so a required prop that did nothing has been removed rather than
  left to mislead.

### The screens each take their own slice

`AiLanding`, `AiCapabilities`, `AiStatusBoard` and `HostSelectStep` are exported
standalone, so each takes the slice it renders (`copy.landing`,
`copy.capabilities`, `copy.statusBoard`, `copy.hostSelect`) rather than the whole
object — a host mounting only the status board should not have to supply words
for a wizard it never renders. `<AiIntegrationOnboarding>` takes the whole
`McpAiCopy` and passes the slices down.

### The icons stayed

The landing's reassurance strip is keyed by the pack's own ids (`login`,
`install`, `permissions`, `surface`) against an icon map inside the package. An
icon is not copy, and a pack that had to ship React elements could not be a
plain data file. An id the map does not know renders without an icon rather
than throwing, so a host adding a fifth point still gets its words on screen.
