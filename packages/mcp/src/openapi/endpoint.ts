import type { z } from "zod";

/**
 * How a route is DECLARED, one step before it becomes an OpenAPI operation and
 * two before it becomes a tool.
 *
 * This package already owns everything downstream of an OpenAPI document —
 * `generateTools` turns operations into tools, `dispatchTool` proxies a call,
 * `redactResponseSchema`/`redactResponseBody` narrow both halves. What it did
 * not own was the shape a consumer writes its routes down in, so every consumer
 * declared its own. That is fine for one app and wrong for several: a monorepo
 * where the shift routes, the lifecycle routes and the audit routes are each
 * packaged separately needs those packages to produce endpoint lists the HOST
 * can concatenate, which they can only do if they all mean the same thing by
 * "an endpoint".
 *
 * Deliberately zod-shaped rather than JSON-Schema-shaped. A route validates its
 * input with zod at runtime; describing it a second time in JSON Schema is a
 * copy that drifts, and the drift is invisible — the manifest keeps advertising
 * the shape the route stopped accepting. Converting zod → JSON Schema at
 * generate time makes the validator the single source of truth.
 *
 * zod is a PEER dependency: it is referenced here as a type only, so this
 * package pulls no copy of its own and cannot end up type-checking against a
 * different one than the consumer declares its schemas with.
 */

/** The methods an MCP-exposed route may use. */
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

interface McpEndpointBase {
  /** Stable tool id — this becomes the MCP tool name, so renaming it is a
   *  breaking change for every agent that has learned the old one. */
  operationId: string;
  method: HttpMethod;
  /** OpenAPI path template, e.g. `/api/products/{id}`. */
  path: string;
  /** What the tool is FOR, in the words an agent reads when choosing it. */
  summary: string;
  tags?: string[];
  /** Object schema whose properties become query parameters. */
  query?: z.ZodType;
  /** Object schema whose properties become path parameters. */
  params?: z.ZodType;
  /** Request body schema (writes only). */
  body?: z.ZodType;
}

/**
 * A declared endpoint either answers 200 with a schema'd JSON body (the
 * default) or 204 No Content (fire-and-forget writes).
 *
 * The union is what makes the two mutually exclusive: a 204 entry cannot carry
 * a response schema, so a manifest can never advertise a body its route will
 * not send — a mismatch an agent experiences as a tool that returns nothing
 * where its own schema promised an object.
 */
export type McpEndpoint = McpEndpointBase &
  (
    | {
        /** Success status (defaults to 200 with a JSON body). */
        status?: 200;
        /** Success (200) response schema. */
        response: z.ZodType;
      }
    | {
        /** 204 No Content — no response schema. */
        status: 204;
        response?: never;
      }
  );
