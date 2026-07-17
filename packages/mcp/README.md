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

## What the app provides (not here)

- The **OpenAPI document** (from its Zod-schema'd routes).
- The **`AuthResolver`** — validates the incoming access token (OAuth
  resource-server: signature / audience / scope) and returns the bearer to
  forward. In future-pay this is the `getRequestSession()` shim over NextAuth
  `auth()`.
- Binding `ToolRegistry` to the **MCP transport** (the `@modelcontextprotocol/sdk`
  HTTP server at `/api/mcp`).

## Status

Scaffold: the generator, dispatcher, registry, manifest, and OAuth
resource-metadata helpers are implemented and dependency-light (no MCP SDK). The
SDK/HTTP transport binding and the app-side `AuthResolver` land in the pilot's
next phase (`apps/web`). See the pilot design notes under `docs/`.
