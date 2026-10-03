# @12-apps/mcp

App-agnostic core for exposing an app's HTTP endpoints as an MCP server, where
**the agent acts with exactly the calling user's permissions**.

## The idea

Generate **one MCP tool per OpenAPI operation**, and dispatch each tool call by
**proxying to the real endpoint carrying the caller's bearer token**. Because the
proxy hits the same endpoints a browser would, all existing auth/authorization
(session guards, tenant scoping, role checks) runs unchanged — this package holds
**zero** authorization logic. An agent can do precisely what the user can, no
more.

This is the passthrough pattern, not the "golden catalog" curation pattern: 1:1
tools, no hand-written field maps. That is what makes it generatable and portable
across apps.

## The two invariants a consuming app must satisfy

1. **Schema'd HTTP surface** — every agent-exposable operation is an HTTP endpoint
   described in an OpenAPI document generated from runtime schemas (Zod →
   OpenAPI). That document is this package's only input.
2. **One standard bearer auth** — every endpoint authenticates a caller from an
   `Authorization: Bearer <token>` resolving to the same identity/permissions as a
   normal session. The proxy forwards the token blindly.

## What this package provides

| Export | Role |
|--------|------|
| `generateTools(doc, opts)` | OpenAPI operations → `GeneratedTool[]` (input schema + HTTP routing metadata). Deterministic. |
| `createToolRegistry({ tools, baseUrl })` | Transport-agnostic `listTools` / `callTool`; `callTool` proxies with the caller's bearer. |
| `dispatchTool(tool, args, cfg)` | The generic auth-proxy: routes flat args → path/query/header/body, forwards the bearer. |
| `buildManifest` / `serializeManifest` | The committed drift artifact `mcp:check` regenerates + diffs (see `12-apps/ci` `mcp-contract.yml`). |
| `buildProtectedResourceMetadata` / `bearerChallenge` | OAuth 2.0 Protected Resource Metadata (RFC 9728) + `WWW-Authenticate` for the resource-server mode. |

## The authorization server (12-23)

The passthrough above needs somebody to MINT the bearer it forwards, and until
12-23 every app wrote that itself — ~1.5k LOC of authorize/token/register plus the
code, PKCE, rotation and replay machinery under it. All of that is the surface's
contract, so it lives here now:

| Entry | Export | Role |
|---|---|---|
| `./oauth` | `createApiMcpOauth({ stores, resolveSession })` | OAuth 2.1 authorization server: `register` (RFC 7591) / `authorize` (code + mandatory PKCE S256) / `token` (code + refresh), the JWKS, and BOTH `.well-known` documents. Also the primitives — stateless signed codes, ES256 access tokens, hashed rotating refresh tokens with lineage revocation and a retry grace window, the `verifyBearer` resource-server half. |
| `./hono` | `mcpOauthRouter(config)` | The same surface as a router, mounted at the **origin root** (a connector reads `.well-known` from the origin, never from a prefix). `hono` is an OPTIONAL peer. |
| `./generate` | `mcpGenerateCli(options)` | `mcp:generate` / `mcp:check` — the committed manifest and its drift gate. |
| `./coverage` | `mcpCoverageCli(options)` | `mcp:coverage` — every route method and server action either exposed as a tool or excluded with a reason. |
| `prisma/` | `mcp.prisma` + a migration | `OAuthClient`, `OAuthRefreshToken`, `McpConnection`. Authorization codes are deliberately NOT a table: they are stateless signed blobs. |

The gates are library + CLI FACE, so a host's `scripts/mcp/{generate,coverage}.ts`
becomes an import and one call, and the reusable CI workflows
(`12-apps/ci`'s `mcp-contract.yml`) keep shelling out to the same package scripts.

**[ADOPTING.md](./ADOPTING.md) is the adoption contract** — the config table, the
ten wiring rules (the operator gate, the trusted-origin allowlist, the
multi-instance caveat on the replay store) and the Phase B notes.

```ts
const mcpOauth = mcpOauthRouter({
  stores: createPrismaMcpStores(async () => (await getPrismaClient()) as unknown as McpOauthPrisma),
  resolveSession: async (request) => sessionOf(request),   // cookie session ONLY
  enabled: () => process.env.MCP_BEARER_ENABLED === '1',
  trustedOrigins: trustedOriginsFromEnv('MCP_OAUTH_TRUSTED_ORIGINS'),
});
app.route('/', mcpOauth.router);
```

## What the app provides (not here)

- The **OpenAPI document** (from its Zod-schema'd routes) and the registry that
  decides which endpoints become tools.
- **Who is signed in** — the cookie session `authorize` binds a code to, and the
  `AuthResolver` for the resource-server side.
- **Where the data lives** — the three stores (one line with
  `createPrismaMcpStores`), and the signing material.
- Binding `ToolRegistry` to the **MCP transport** (the `@modelcontextprotocol/sdk`
  HTTP server at `/api/mcp`).

## Interactive OAuth consent and live revocation

A host can require an explicit resource-owner decision before any authorization
code is issued:

```ts
createApiMcpOauth({
  // Existing stores, cookie-only session resolver and signing configuration…
  consent: {
    path: "/admin/oauth-consent",
    replay: sharedConsentReplayStore,
    requireClientApproval: true,
  },
  isAccessTokenActive: (binding) =>
    isRefreshBindingActive(stores.refreshTokens, binding),
});
```

The cookie resolver must return a stable per-login `sessionBinding`, in addition
to `email` and `subject`. `@12-apps/auth` exposes the verified session's
`loginSessionId` for this purpose. Raw JWT cookie bytes, `iat` and `jti` rotate on
ordinary session reads and must not be used. A user id or email alone is not a
login-session binding. Never resolve bearer authentication as the
resource-owner session. A changed/expired login session requires restarting the
flow; the client cannot supply or override its identity. An authenticated legacy
session with no nonce is sent to the consent UI with `reauthenticate=1` and no
ticket or code. Show a sign-out/sign-in instruction instead of looping through a
login page that considers the user already authenticated.

`GET authorize` validates the exact registered callback and PKCE request, then
redirects to the configured same-origin UI with a five-minute signed `request`
ticket. It issues no code. The ticket contains the original authorization query
and a one-way session binding, never the session cookie or the user's identity.
The UI fetches `handlers.consentDetails` (`GET /api/oauth/consent?request=…`) and
renders the verified `accountEmail`, registered client name/id, exact callback
and requested scopes as escaped text. The account identity is response-only. It must offer explicit approve and deny controls. Do not log
request tickets, include them in telemetry, or send them as referrers.

`handlers.consentDecision` accepts only a same-origin JSON POST containing
`{ request, decision: "approve" | "deny" }`. It rechecks the cookie session,
registration and request, atomically consumes the ticket, and returns
`{ redirectUrl }`. Only approval mints a code. Denial returns the validated
callback with `error=access_denied` and the original state. Missing/different
Origin, changed session, modified ticket, OAuth-field overrides, expiry and
replay fail closed. The UI navigates only after a successful response. A lost
response, refresh/back or repeated click cannot mint a second code; restart the
client authorization flow after a terminal error. Separate tabs have separate
tickets and do not overwrite one another.

When `requireClientApproval` is true, legacy operator/provider rules remain an
eligibility ceiling, checked before the ticket and again before the decision.
They never replace the human decision, including preapproved client ids. Without
that flag, explicit consent replaces the legacy approval seam.

The consent replay store is distinct from the 90-second authorization-code
store: `consume(jti, nowMs, expiresAtMs)` must be shared, atomic and retain a claim
until the signed ticket expires. An outage must refuse, with no process-local
fallback. `inProcessConsentReplayStore()` is only for an explicitly single-process
host or tests. Consent routes are included in the wiring descriptors only when
consent is configured; all handlers remain behind the operator gate.

Access tokens now bind the exact issued refresh row by its non-secret SHA-256
identifier. `isRefreshBindingActive` follows only unique direct successors, so
normal refresh preserves already-issued access until its own expiry. Disconnect
and replay invalidate the live lineage on the next verification; reconnecting
creates an unrelated root and cannot revive old access, even in the same second.
Legacy access tokens with no binding fail closed when the verifier hook is
enabled. An existing valid refresh token can rotate into bound access without
another cookie login or broader scopes; automatic client refresh may recover the
connection. Reconnection is needed only when refresh is unavailable or revoked.
A legacy cookie's missing login nonce requires a fresh sign-in only when starting
a new authorization. There must be no positive-result cache for immediate revocation.

Prisma stores use the indexed `rotated_from` lookup, limited to two rows to refuse
ambiguous branching. Apply the additive index migration alongside adoption.
Traversal refuses cycles, malformed links, identity changes and more than 32
successor hops. A normal 15-minute access token crosses zero or one rotation;
32 allows aggressive clients while bounding database work. A client exceeding
that bound must use its newest access token.

Prisma rotation, replay revocation, and both halves of disconnect run in
Serializable transactions. Write conflicts retry the entire transaction up to
three times; exhaustion reports failure and rolls back instead of hiding a
connection with live credentials. Custom stores should implement the optional
atomic `revokeLineage` and `connections.disconnect` ports with equivalent
serialization; a non-atomic read-then-revoke can miss a concurrently rotated
successor. The package tests pin transaction boundaries and complete-operation
retries; multi-session PostgreSQL validation must exercise actual conflicting
rotation, replay, disconnect and delayed-activity operations.
