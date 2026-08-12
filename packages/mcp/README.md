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
| `./oauth` | `createApiMcpOauth({ stores, resolveSession })` | OAuth 2.1 authorization server: `register` (RFC 7591) / `authorize` (code + mandatory PKCE S256) / `token` (code + refresh), the JWKS, and BOTH `.well-known` documents. Also the primitives — stateless signed codes, ES256 access tokens, hashed rotating refresh tokens with lineage revocation, the `verifyBearer` resource-server half. |
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
