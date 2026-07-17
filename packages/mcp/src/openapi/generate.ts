import type {
  GeneratedTool,
  GenerateOptions,
  JsonSchema,
  ParameterLocation,
  ToolParameter,
} from "../types";

/**
 * Minimal structural view of the OpenAPI 3.x document we consume. We intentionally
 * model only the subset the generator reads; unknown fields are ignored and any
 * `$ref` in a leaf schema is forwarded opaquely (the document is expected to be
 * dereferenced by the loader for anything we need to introspect — request-body
 * object properties in particular).
 */
export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
}

export interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: JsonSchema;
}

export interface OpenApiRequestBody {
  required?: boolean;
  content?: Record<string, { schema?: JsonSchema }>;
}

export interface OpenApiResponse {
  content?: Record<string, { schema?: JsonSchema }>;
}

export interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  security?: Array<Record<string, string[]>>;
}

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "options", "head"] as const;
const MUTATING = new Set(["post", "put", "patch", "delete"]);
const PARAM_LOCATIONS = new Set<ParameterLocation>(["path", "query", "header"]);

/** JSON body is the only content type the generic dispatcher understands. */
const JSON_CONTENT = "application/json";

function slugify(method: string, path: string): string {
  const cleaned = path
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${method.toLowerCase()}_${cleaned || "root"}`;
}

function securityNames(op: OpenApiOperation, doc: OpenApiDocument): string[] {
  const requirements = op.security ?? doc.security ?? [];
  return [...new Set(requirements.flatMap((requirement) => Object.keys(requirement)))];
}

function bodySchema(op: OpenApiOperation): JsonSchema | undefined {
  return op.requestBody?.content?.[JSON_CONTENT]?.schema;
}

function responseSchema(op: OpenApiOperation): JsonSchema | undefined {
  const responses = op.responses ?? {};
  const code = ["200", "201", "2XX", "default"].find((c) => responses[c]?.content?.[JSON_CONTENT]?.schema);
  return code ? responses[code]?.content?.[JSON_CONTENT]?.schema : undefined;
}

/** Path params are always required regardless of how the spec marks them. */
function paramRequired(location: ParameterLocation, raw: OpenApiParameter): boolean {
  return location === "path" ? true : Boolean(raw.required);
}

/** OpenAPI path/query/header params (body is handled separately), in declaration order. */
function toolParameters(op: OpenApiOperation): ToolParameter[] {
  return (op.parameters ?? [])
    .filter((raw) => PARAM_LOCATIONS.has(raw.in as ParameterLocation))
    .map((raw) => {
      const location = raw.in as ParameterLocation;
      return {
        name: raw.name,
        in: location,
        required: paramRequired(location, raw),
        schema: raw.schema ?? { type: "string" },
      };
    });
}

interface BodyContribution {
  properties: Record<string, JsonSchema>;
  bodyProps: string[];
  requiredProps: string[];
  bodyIsWhole: boolean;
}

/**
 * How the request body contributes to the flat input schema: an object body is
 * flattened (its property names recorded so the dispatcher routes them back to
 * the body); a non-object/opaque body is exposed as a single verbatim `body`
 * property.
 */
function bodyContribution(op: OpenApiOperation): BodyContribution {
  const body = bodySchema(op);
  if (!body) return { properties: {}, bodyProps: [], requiredProps: [], bodyIsWhole: false };

  const propSchemas = body.properties as Record<string, JsonSchema> | undefined;
  if (body.type === "object" && propSchemas) {
    const bodyRequired = new Set(Array.isArray(body.required) ? (body.required as string[]) : []);
    const bodyProps = Object.keys(propSchemas);
    return {
      properties: propSchemas,
      bodyProps,
      requiredProps: bodyProps.filter((key) => bodyRequired.has(key)),
      bodyIsWhole: false,
    };
  }

  return {
    properties: { body },
    bodyProps: [],
    requiredProps: op.requestBody?.required ? ["body"] : [],
    bodyIsWhole: true,
  };
}

interface BuiltInput {
  inputSchema: JsonSchema;
  parameters: ToolParameter[];
  bodyProps: string[];
  bodyIsWhole: boolean;
}

/**
 * Build the agent-facing input schema and the routing metadata for one operation.
 * Parameters and (flattened) body properties share one flat top level.
 */
function buildInput(op: OpenApiOperation): BuiltInput {
  const parameters = toolParameters(op);
  const paramProps: Record<string, JsonSchema> = {};
  const required: string[] = [];
  parameters.forEach((param) => {
    paramProps[param.name] = param.schema;
    if (param.required) required.push(param.name);
  });

  const body = bodyContribution(op);
  const properties = { ...paramProps, ...body.properties };
  const allRequired = [...required, ...body.requiredProps];
  const inputSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    properties,
    ...(allRequired.length ? { required: allRequired } : {}),
  };
  return { inputSchema, parameters, bodyProps: body.bodyProps, bodyIsWhole: body.bodyIsWhole };
}

/** The declared operations of a path item, as (method, operation) pairs. */
function operationEntries(
  pathItem: Record<string, OpenApiOperation>,
): Array<[string, OpenApiOperation]> {
  return HTTP_METHODS.filter((method) => pathItem[method]).map((method) => [
    method,
    pathItem[method] as OpenApiOperation,
  ]);
}

function buildTool(
  method: string,
  path: string,
  op: OpenApiOperation,
  doc: OpenApiDocument,
  seenNames: Set<string>,
): GeneratedTool {
  const candidate = op.operationId ?? slugify(method, path);
  const name = seenNames.has(candidate) ? slugify(method, path) : candidate;
  seenNames.add(name);

  const { inputSchema, parameters, bodyProps, bodyIsWhole } = buildInput(op);
  return {
    name,
    description: op.summary ?? op.description ?? `${method.toUpperCase()} ${path}`,
    method: method.toUpperCase(),
    path,
    inputSchema,
    outputSchema: responseSchema(op),
    parameters,
    bodyProps,
    bodyIsWhole,
    mutating: MUTATING.has(method),
    security: securityNames(op, doc),
  };
}

/**
 * Generate one {@link GeneratedTool} per OpenAPI operation. Deterministic: the
 * same document always yields the same tools in path/method declaration order,
 * which is what makes the drift gate (`mcp:check`) a stable diff.
 */
export function generateTools(
  doc: OpenApiDocument,
  options: GenerateOptions = {},
): GeneratedTool[] {
  const includeMethods = options.includeMethods
    ? new Set(options.includeMethods.map((m) => m.toLowerCase()))
    : null;
  const excludeTags = new Set(options.excludeTags ?? []);
  const seenNames = new Set<string>();

  return Object.entries(doc.paths ?? {}).flatMap(([path, pathItem]) =>
    operationEntries(pathItem)
      .filter(([method]) => !includeMethods || includeMethods.has(method))
      .filter(([, op]) => !op.tags?.some((tag) => excludeTags.has(tag)))
      .filter(([method]) => !options.filter || options.filter(method, path))
      .map(([method, op]) => buildTool(method, path, op, doc, seenNames)),
  );
}
