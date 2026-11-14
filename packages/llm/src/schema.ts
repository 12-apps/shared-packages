/**
 * The strict-schema rule every tool input schema meets, whatever the provider.
 *
 * Each provider's strict mode guarantees the model's arguments validate
 * against the schema, and each asks for a slightly different subset. The
 * common ground, which this check enforces, is: the root is an object; every
 * object sets `additionalProperties: false`; every object lists ALL its
 * properties in `required`. An optional field is spelled as a nullable type
 * (`type: ["string", "null"]`), which every provider accepts.
 */
import type { JsonSchema, ToolDefinition } from "./types";

const NESTED_SINGLE = ["items", "not", "additionalItems"] as const;
const NESTED_LIST = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;
const NESTED_MAP = ["properties", "$defs", "definitions"] as const;

function isObjectSchema(schema: JsonSchema): boolean {
  const type = schema.type;
  return type === "object" || (Array.isArray(type) && type.includes("object")) || "properties" in schema;
}

function asSchema(value: unknown): JsonSchema | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonSchema) : null;
}

function objectProblems(schema: JsonSchema, path: string): string[] {
  const problems: string[] = [];
  if (schema.additionalProperties !== false) {
    problems.push(`${path}: an object must set additionalProperties: false`);
  }
  const properties = asSchema(schema.properties) ?? {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of Object.keys(properties)) {
    if (!required.includes(key)) {
      problems.push(`${path}: property "${key}" must be listed in required (use a nullable type for an optional field)`);
    }
  }
  return problems;
}

function nestedSchemas(schema: JsonSchema, path: string): Array<[JsonSchema, string]> {
  const single = NESTED_SINGLE.map((key): [unknown, string] => [schema[key], `${path}.${key}`]);
  const listed = NESTED_LIST.flatMap((key) => {
    const list = schema[key];
    return Array.isArray(list) ? list.map((item, index): [unknown, string] => [item, `${path}.${key}[${index}]`]) : [];
  });
  const mapped = NESTED_MAP.flatMap((key) =>
    Object.entries(asSchema(schema[key]) ?? {}).map(([name, value]): [unknown, string] => [value, `${path}.${key}.${name}`]),
  );
  return [...single, ...listed, ...mapped].flatMap(([value, at]): Array<[JsonSchema, string]> => {
    const child = asSchema(value);
    return child ? [[child, at]] : [];
  });
}

/** Every reason `schema` is not strict, with a path to each; empty when it is. */
export function strictSchemaProblems(schema: JsonSchema, path = "$"): string[] {
  const own = isObjectSchema(schema) ? objectProblems(schema, path) : [];
  return own.concat(...nestedSchemas(schema, path).map(([child, at]) => strictSchemaProblems(child, at)));
}

/** Every problem in a tool list: duplicate names and non-strict schemas. */
export function toolSchemaProblems(tools: readonly ToolDefinition[]): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) problems.push(`tool "${tool.name}" is defined twice`);
    seen.add(tool.name);
    if (tool.inputSchema.type !== "object") problems.push(`tool "${tool.name}": the input schema root must be type "object"`);
    problems.push(...strictSchemaProblems(tool.inputSchema).map((p) => `tool "${tool.name}" ${p}`));
  }
  return problems;
}

/** Throws a TypeError naming every problem in every tool's input schema. */
export function assertStrictTools(tools: readonly ToolDefinition[]): void {
  const problems = toolSchemaProblems(tools);
  if (problems.length > 0) {
    throw new TypeError(`@12-apps/llm: tool schemas are not strict:\n- ${problems.join("\n- ")}`);
  }
}
