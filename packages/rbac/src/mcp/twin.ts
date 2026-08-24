import type { z } from 'zod';

/**
 * Structural twins of `@12-apps/mcp`'s endpoint types, restated here rather
 * than imported.
 *
 * ## Why the import is impossible, not merely unwanted
 *
 * `@12-apps/mcp` DEPENDS ON THIS PACKAGE — its coverage gate imports the route
 * and action walkers from `@12-apps/rbac/coverage`, deliberately, so the walk
 * exists once. A dependency back the other way is a cycle, and the workspace
 * refuses it: `Circular package dependency detected: @12-apps/mcp, @12-apps/rbac`.
 *
 * So this is the payments-backend situation exactly, and it takes the same
 * answer. `PaymentsJobBlueprint` is a structural twin of `@12-apps/jobs`'
 * `JobBlueprint` for a portability rule that forbids even a type-only import;
 * these are twins of `McpEndpoint` for an edge that runs the other way. In both
 * cases the types check against each other with no import in either direction,
 * and the ASSIGNABILITY is pinned from the side that may import both.
 *
 * That pin is `packages/mcp/src/__tests__/rbac-endpoints.test.ts`, and it is the
 * whole reason this file is safe. A twin nobody compares is a twin that drifts —
 * the failure the wiring RFC opens with. `@12-apps/mcp` can import this package,
 * so the comparison lives there, where it costs nothing and cannot be skipped.
 */

/** Twin of `@12-apps/mcp`'s `HttpMethod`. */
export type RbacHttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Twin of `McpAnnotationDefaults` — behaviour a package asserts about its own tool. */
export interface RbacMcpAnnotations {
  /** Human title override; deliberately unset here — the label is host copy. */
  title?: string;
  /** The tool only reads — never mutates host state. */
  readOnly?: boolean;
  /** A destructive write (delete/purge), as opposed to an additive one. */
  destructive?: boolean;
  /** The tool reaches beyond the host's own data. */
  openWorld?: boolean;
}

interface RbacMcpEndpointBase {
  operationId: string;
  method: RbacHttpMethod;
  path: string;
  summary: string;
  tags?: string[];
  query?: z.ZodType;
  params?: z.ZodType;
  body?: z.ZodType;
  annotations?: RbacMcpAnnotations;
}

/**
 * Twin of `McpEndpoint`, union and all.
 *
 * The union is carried rather than flattened because it is load-bearing on the
 * other side: a 204 entry cannot also declare a response schema, so a manifest
 * can never advertise a body its route will not send. Flattening it here would
 * make the twin ASSIGNABLE while dropping the property the original exists for,
 * and the pin would still pass.
 */
export type RbacMcpEndpoint = RbacMcpEndpointBase &
  ({ status?: 200; response: z.ZodType } | { status: 204; response?: never });
