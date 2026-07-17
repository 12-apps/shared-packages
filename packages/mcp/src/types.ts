/**
 * Core types for the app-agnostic MCP layer.
 *
 * The design in one sentence: generate one MCP tool per OpenAPI operation, and
 * dispatch each tool call by proxying to the real HTTP endpoint carrying the
 * caller's bearer token — so an agent gets exactly the user's permissions and
 * authorization stays entirely in the endpoints (never re-implemented here).
 *
 * This package is deliberately free of any app/domain specifics and of the MCP
 * transport SDK: it turns a spec into tools and a tool call into an HTTP request.
 * The consuming app supplies the OpenAPI document, the base URL, and an
 * {@link AuthResolver}; it binds {@link ToolRegistry} to the MCP transport.
 */

/** A JSON Schema object (draft 2020-12). We treat schemas opaquely and forward them. */
export type JsonSchema = Record<string, unknown>;

/** Where an operation parameter is carried in the HTTP request. */
export type ParameterLocation = "path" | "query" | "header";

/** One OpenAPI operation parameter, retained so the dispatcher can route args. */
export interface ToolParameter {
  name: string;
  in: ParameterLocation;
  required: boolean;
  schema: JsonSchema;
}

/**
 * A single generated MCP tool: an agent-facing input schema plus everything the
 * dispatcher needs to reconstruct the HTTP call. This is the unit that is both
 * served to agents and committed to the drift manifest.
 */
export interface GeneratedTool {
  /** Stable tool id: the operationId, or a `method_path` slug when absent. */
  name: string;
  description: string;
  /** Uppercase HTTP method, e.g. "GET", "POST". */
  method: string;
  /** OpenAPI path template, e.g. "/products/{id}". */
  path: string;
  /** Agent-facing input schema (params + flattened request-body properties). */
  inputSchema: JsonSchema;
  /** Documented success-response schema, when the spec provides one. */
  outputSchema?: JsonSchema;
  /** Path/query/header parameters, in declaration order. */
  parameters: ToolParameter[];
  /** Top-level property names sourced from the request body (routed to the body). */
  bodyProps: string[];
  /** True when the request body is not an object (sent verbatim as the payload). */
  bodyIsWhole: boolean;
  /** True for POST/PUT/PATCH/DELETE — a write. Consumers may gate these. */
  mutating: boolean;
  /** OpenAPI security requirement names referenced by the operation, if any. */
  security: string[];
}

/** The committed source-of-truth artifact the drift gate (`mcp:check`) diffs. */
export interface ToolManifest {
  /** Bumped on any intentional shape change (mirrors the golden-catalog convention). */
  version: number;
  /** Human label for the spec the tools were generated from. */
  source: string;
  tools: GeneratedTool[];
}

/** Options controlling tool generation from an OpenAPI document. */
export interface GenerateOptions {
  /** Only include operations whose method is in this set (default: all). */
  includeMethods?: readonly string[];
  /** Drop operations tagged with any of these (e.g. "internal"). */
  excludeTags?: readonly string[];
  /** Predicate to include/exclude an operation by (method, path). */
  filter?: (method: string, path: string) => boolean;
}

/**
 * The caller's resolved authorization for a single request. The dispatcher only
 * ever forwards `bearer` upstream; identity/permission checks happen at the
 * endpoint. `subject`/`scopes` are surfaced for logging and tool-visibility
 * decisions, not for authorization.
 */
export interface RequestAuth {
  /** The bearer token to forward to the upstream endpoint (verbatim). */
  bearer: string;
  /** Token subject (for logging only). */
  subject?: string;
  /** Granted scopes (for optional tool visibility filtering). */
  scopes?: readonly string[];
}

/**
 * App-supplied hook that turns an incoming request into {@link RequestAuth}, or
 * `null` when unauthenticated. For the OAuth resource-server mode this validates
 * the access token (signature/audience/scope) and returns the token to forward.
 */
export type AuthResolver = (request: Request) => Promise<RequestAuth | null>;

/** Configuration for a proxying dispatch. */
export interface DispatchConfig {
  /** Origin the tools are proxied to, e.g. "https://app.example.com". */
  baseUrl: string;
  /** The caller's bearer, forwarded as `Authorization: Bearer <token>`. */
  bearer: string;
  /** Injectable fetch (defaults to global fetch) — eases testing. */
  fetchImpl?: typeof fetch;
}

/** The upstream response, normalized for the MCP layer. */
export interface DispatchResult {
  status: number;
  ok: boolean;
  /** Parsed JSON body when the response was JSON, else the raw text. */
  body: unknown;
}
