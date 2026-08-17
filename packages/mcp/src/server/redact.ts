import type { JsonSchema } from "../types";

/**
 * Both halves of the redaction contract: the SCHEMA a tool advertises, and the
 * BODY it returns.
 *
 * They only work as a pair, and the failure mode when they disagree is not a
 * cosmetic one. The dispatcher forwards the wrapped endpoint's response body
 * verbatim, so a narrowed `outputSchema` alone would only change what the
 * manifest CLAIMS is returned — the value still reaches the agent. Strip the
 * body but leave the schema advertising the field, and every successful call
 * fails validation against the very schema the manifest published, worst of all
 * when the field was `required`.
 *
 * So `redactResponseSchema` removes the paths at generate time and
 * `redactResponseBody` removes the same paths at dispatch, from one list. A host
 * that takes one and hand-rolls the other is back to the disagreement this pair
 * exists to prevent.
 */

/** Structural keywords that wrap a value without naming a field. */
const SCHEMA_WRAPPERS = ["items", "anyOf", "oneOf", "allOf"] as const;

function isSchema(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === "object";
}

/** Drop `field` from an object schema's properties AND its `required` list. */
function deleteProperty(schema: JsonSchema, field: string): true {
  delete (schema.properties as Record<string, JsonSchema>)[field];
  if (Array.isArray(schema.required)) {
    const kept = (schema.required as string[]).filter((name) => name !== field);
    if (kept.length) schema.required = kept;
    else delete schema.required;
  }
  return true;
}

/**
 * Descend into wrappers without consuming a segment, so `data.taxId` addresses
 * an array of rows and a `.nullable()` union branch alike.
 */
function omitInWrappers(schema: JsonSchema, segments: readonly string[]): boolean {
  return SCHEMA_WRAPPERS.reduce((removed, keyword) => {
    const child = schema[keyword];
    const branches = Array.isArray(child) ? child : [child];
    return branches.reduce<boolean>(
      (acc, branch) => (isSchema(branch) && omitSchemaPath(branch, segments)) || acc,
      removed,
    );
  }, false);
}

function omitSchemaPath(schema: JsonSchema, segments: readonly string[]): boolean {
  const inWrappers = omitInWrappers(schema, segments);

  const properties = schema.properties as Record<string, JsonSchema> | undefined;
  const [head, ...rest] = segments;
  if (!properties || !head || !(head in properties)) return inWrappers;

  if (rest.length === 0) return deleteProperty(schema, head);

  const child = properties[head];
  return (isSchema(child) && omitSchemaPath(child, rest)) || inWrappers;
}

/**
 * Return `schema` without the listed dotted paths — the advertised half.
 *
 * THROWS when a path names nothing, rather than returning quietly: a typo'd or
 * stale redaction would otherwise protect nothing at all, and it would do so
 * invisibly, which is the one outcome a redaction list must never have. Failing
 * here turns it into a generator error naming the offending path.
 *
 * The input is cloned, not narrowed in place: a caller may hold the converted
 * schema for other uses (a shared `$defs` component, a schema reused across two
 * operations), and mutating it would redact those too.
 *
 * `operationId` only shapes the error message — pass it so the failure names
 * which tool declared the bad path.
 */
export function redactResponseSchema(
  schema: JsonSchema,
  paths: readonly string[],
  operationId?: string,
): JsonSchema {
  if (!paths.length) return schema;

  const clone = structuredClone(schema);
  paths.forEach((path) => {
    if (!omitSchemaPath(clone, path.split("."))) {
      const subject = operationId ? `MCP endpoint "${operationId}"` : "This response schema";
      throw new Error(
        `${subject} declares a response redaction for "${path}", which is not a field of its response schema`,
      );
    }
  });
  return clone;
}

/** Walk one dotted path, mapping over arrays, and delete the leaf. */
function stripPath(value: unknown, segments: readonly string[]): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((entry) => stripPath(entry, segments));
    return;
  }

  const [head, ...rest] = segments;
  if (!head) return;

  const record = value as Record<string, unknown>;
  if (rest.length === 0) {
    delete record[head];
    return;
  }
  if (head in record) stripPath(record[head], rest);
}

/**
 * Return `body` without the listed dotted paths.
 *
 * The input is deep-cloned first: dispatch results are handed straight to the
 * JSON-RPC encoder AND reused as `structuredContent`, so mutating in place
 * could leak a half-redacted object into one of the two surfaces.
 */
export function redactResponseBody(
  body: unknown,
  paths: readonly string[] | undefined,
): unknown {
  if (!paths?.length || body === null || typeof body !== "object") return body;

  const clone = structuredClone(body);
  paths.forEach((path) => stripPath(clone, path.split(".")));
  return clone;
}
