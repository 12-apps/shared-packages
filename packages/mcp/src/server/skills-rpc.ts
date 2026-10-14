import type { JsonRpcRequest, JsonRpcResponse } from "./jsonrpc";
import { SkillCursorError, type SkillCatalog } from "./skills";

/** All skill reads share the host's catalog authorization boundary. */
export function isSkillReadMethod(method: unknown): boolean {
  return method === "skills/list" || method === "skills/get" || method === "resources/read";
}

class SkillParamsError extends Error {
  constructor(message: string, readonly code = -32602) { super(message); }
}

function paramsFor(request: JsonRpcRequest): Record<string, unknown> {
  const params: unknown = request.params === undefined ? {} : request.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new SkillParamsError("Invalid params");
  const values = params as Record<string, unknown>;
  const key = request.method === "skills/list" ? "cursor" : "uri";
  if (Object.keys(values).some((field) => field !== key && field !== "_meta")) throw new SkillParamsError("Invalid params");
  if (values._meta !== undefined) validateMetadata(values._meta);
  return values;
}

function validateMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SkillParamsError("Invalid metadata");
}

function list(catalog: SkillCatalog, values: Record<string, unknown>) {
  if (values.cursor !== undefined && typeof values.cursor !== "string") {
    throw new SkillParamsError("Invalid skills cursor");
  }
  return catalog.list(values.cursor);
}

function read(request: JsonRpcRequest, catalog: SkillCatalog) {
  const values = paramsFor(request);
  if (request.method === "skills/list") return list(catalog, values);
  if (typeof values.uri !== "string") throw new SkillParamsError("Missing resource URI");
  if (request.method === "skills/get") {
    const skill = catalog.get(values.uri);
    if (!skill) throw new SkillParamsError("Unknown skill URI");
    return { skill };
  }
  const content = catalog.read(values.uri);
  if (!content) throw new SkillParamsError("Resource not found", -32002);
  return { contents: [content] };
}

export function handleSkillRead(request: JsonRpcRequest, catalog: SkillCatalog): JsonRpcResponse | null {
  if (request.id === undefined) return null;
  try {
    return { jsonrpc: "2.0", id: request.id, result: read(request, catalog) };
  } catch (cause) {
    if (cause instanceof SkillCursorError) {
      return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Invalid skills cursor" } };
    }
    if (!(cause instanceof SkillParamsError)) throw cause;
    return { jsonrpc: "2.0", id: request.id, error: { code: cause.code, message: cause.message } };
  }
}
