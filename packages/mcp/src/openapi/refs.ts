import type { JsonSchema } from "../types";

/**
 * Raised when a JSON Schema cannot be turned into a flat, self-contained tool
 * input — an unresolvable `$ref`, an unsupported pointer, or a recursive schema.
 * The MCP tool surface is deliberately finite and flat (it is handed to an LLM
 * and committed to the drift manifest), so recursion is rejected rather than
 * silently truncated.
 */
export class UnsupportedSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSchemaError";
  }
}

/** Local-definition containers a `$ref` may point into, in resolution order. */
const REF_PREFIXES = ["#/$defs/", "#/definitions/", "#/components/schemas/"] as const;
const DEF_CONTAINERS = ["$defs", "definitions"] as const;

/** The definition name a supported local pointer targets, or `null` if unsupported. */
function refName(ref: string): string | null {
  const prefix = REF_PREFIXES.find((candidate) => ref.startsWith(candidate));
  return prefix ? decodeURIComponent(ref.slice(prefix.length)) : null;
}

/** Collect the `$defs`/`definitions` maps hoisted onto a schema root into one lookup. */
function collectDefs(root: JsonSchema): Record<string, JsonSchema> {
  const defs: Record<string, JsonSchema> = {};
  DEF_CONTAINERS.forEach((key) => {
    const container = root[key];
    if (container && typeof container === "object") {
      Object.assign(defs, container as Record<string, JsonSchema>);
    }
  });
  return defs;
}

function inlineRef(
  ref: string,
  defs: Record<string, JsonSchema>,
  active: Set<string>,
): unknown {
  const name = refName(ref);
  if (name === null) throw new UnsupportedSchemaError(`Unsupported $ref pointer: ${ref}`);
  const target = defs[name];
  if (!target) throw new UnsupportedSchemaError(`Unresolved $ref: ${ref}`);
  if (active.has(name)) throw new UnsupportedSchemaError(`Recursive schema not supported: ${name}`);
  active.add(name);
  const resolved = walk(target, defs, active);
  active.delete(name);
  return resolved;
}

/** Deep-copy `node`, inlining every `$ref` and stripping definition containers. */
function walk(node: unknown, defs: Record<string, JsonSchema>, active: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((item) => walk(item, defs, active));
  if (!node || typeof node !== "object") return node;

  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === "string") return inlineRef(obj.$ref, defs, active);

  const out: Record<string, unknown> = {};
  Object.entries(obj).forEach(([key, value]) => {
    if (!DEF_CONTAINERS.includes(key as (typeof DEF_CONTAINERS)[number])) {
      out[key] = walk(value, defs, active);
    }
  });
  return out;
}

/**
 * Inline every local `$ref` in a JSON Schema and drop the now-empty `$defs`/
 * `definitions` containers, yielding a flat, self-contained schema. Diamond reuse
 * (the same definition referenced by sibling branches) is fine; only a true cycle
 * — a definition that references itself up the resolution stack — is rejected.
 *
 * A schema with no `$ref`/definitions is returned structurally unchanged, so
 * inlining an already-flat spec is a no-op (the drift gate stays a stable diff).
 */
export function inlineSchemaRefs(schema: JsonSchema): JsonSchema {
  const defs = collectDefs(schema);
  return walk(schema, defs, new Set<string>()) as JsonSchema;
}
