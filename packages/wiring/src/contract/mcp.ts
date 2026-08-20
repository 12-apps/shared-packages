/**
 * The MCP capability: tool declarations a host registry can concatenate.
 *
 * `@12-apps/mcp`'s `McpEndpoint` is already the concatenatable shape, and
 * `@12-apps/entity-lifecycle/mcp` is the working example of a package handing
 * a host a list of them. This contract restates the shape with the schemas
 * generic (`TSchema` is `z.ZodType` in practice — this package takes no zod
 * dependency), and adds the one channel `McpEndpoint` is missing:
 * `annotations`.
 *
 * Annotations are the reason 48 package-declared lifecycle tools still cost
 * 48 hand-written lines in the origin host's `tool-policy-hints.ts`: the
 * package knows perfectly well that `getSupplierVersions` is read-only and
 * non-destructive, but the declaration has no field to say so. Here it does.
 * They are DEFAULTS — the host's audited policy table may override any of
 * them, and a host gate can still require that every tool end up classified;
 * what changes is that the package's own knowledge arrives with the tool.
 */

/**
 * Behavior defaults the package declares for one tool. Mirrors the MCP spec's
 * `ToolAnnotations` vocabulary as the origin host's policy tables use it.
 */
export interface WireMcpAnnotations {
  /** Human title override; hosts may re-derive from the operation id. */
  title?: string;
  /** The tool only reads — never mutates host state. */
  readOnly?: boolean;
  /** A destructive write (delete/purge), as opposed to an additive one. */
  destructive?: boolean;
  /** The tool reaches beyond the host's own data (external services). */
  openWorld?: boolean;
}

/**
 * One MCP tool declaration. A structural superset of `@12-apps/mcp`'s
 * `McpEndpoint` (which satisfies it with `TSchema = z.ZodType` and no
 * `annotations`), so existing endpoint lists slot in unchanged.
 */
export interface WireMcpTool<TSchema = unknown> {
  /** Becomes the tool name; unique across the whole assembled surface. */
  operationId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * OpenAPI `{param}` template path. In a MANIFEST whose package also
   * declares an `http` capability, this is RELATIVE to that capability's
   * mount — the consumer prefixes the adoption's `mountPath` (converted to
   * `{param}` form), so a tool's URL and its route's URL cannot drift apart.
   * Everywhere else (host-built tools joined through an adoption's
   * `mcpEndpoints`, packages with no http capability) it is absolute in the
   * host's URL space.
   */
  path: string;
  /** The agent-facing sentence. The words stay whoever wrote them's. */
  summary: string;
  tags?: readonly string[];
  query?: TSchema;
  params?: TSchema;
  body?: TSchema;
  status?: number;
  response?: TSchema;
  annotations?: WireMcpAnnotations;
}

/**
 * The producer side of the capability: the tools a package can declare
 * WITHOUT host vocabulary. Vocabulary-dependent factories (the
 * `lifecycleMcpEndpoints(vocabulary)` pattern — host nouns, host paths, host
 * summaries) stay package exports the host calls; their results join the
 * aggregate through the adoption's `mcpEndpoints` extension, so the consumer
 * still uniqueness-checks and annotation-carries every tool either way.
 */
export interface McpContribution<TSchema = unknown> {
  endpoints: readonly WireMcpTool<TSchema>[];
}
