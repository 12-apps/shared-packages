import type { DispatchConfig, DispatchResult, GeneratedTool } from "../types";

/** Raised when tool arguments cannot be routed onto the HTTP request. */
export class DispatchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchInputError";
  }
}

/** Expand a path template (`/products/{id}`) using the path args, URL-encoding each. */
function expandPath(
  tool: GeneratedTool,
  args: Record<string, unknown>,
): string {
  return tool.path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = args[key];
    if (value === undefined || value === null) {
      throw new DispatchInputError(`Missing required path parameter: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}

/**
 * Route the non-path parameters (query + header) from the flat args. A missing
 * required parameter is a hard error; a missing optional one is simply omitted.
 */
function routeParams(
  tool: GeneratedTool,
  args: Record<string, unknown>,
): { query: URLSearchParams; headers: Record<string, string> } {
  const query = new URLSearchParams();
  const headers: Record<string, string> = {};

  tool.parameters
    .filter((param) => param.in !== "path")
    .forEach((param) => {
      const value = args[param.name];
      if (value === undefined || value === null) {
        if (param.required) {
          throw new DispatchInputError(`Missing required ${param.in} parameter: ${param.name}`);
        }
        return;
      }
      if (param.in === "query") query.set(param.name, String(value));
      else headers[param.name] = String(value);
    });

  return { query, headers };
}

/**
 * Reconstruct the request body from the flat args using the routing metadata.
 * Anything not claimed by a known body property is dropped — the input schema is
 * `additionalProperties: false`, so a validated call never carries extras and an
 * unvalidated one cannot smuggle fields upstream.
 */
function routeBody(tool: GeneratedTool, args: Record<string, unknown>): unknown {
  if (tool.bodyIsWhole) return args.body;
  if (!tool.bodyProps.length) return undefined;
  const payload: Record<string, unknown> = {};
  tool.bodyProps.forEach((key) => {
    if (args[key] !== undefined) payload[key] = args[key];
  });
  return Object.keys(payload).length ? payload : undefined;
}

/**
 * Execute one generated tool by proxying to its HTTP endpoint, forwarding the
 * caller's bearer verbatim. This function performs NO authorization — the
 * endpoint does, exactly as it would for a first-party request. That is the whole
 * point of the passthrough: the agent can do precisely what the user can.
 */
export async function dispatchTool(
  tool: GeneratedTool,
  args: Record<string, unknown>,
  config: DispatchConfig,
): Promise<DispatchResult> {
  const doFetch = config.fetchImpl ?? fetch;
  const pathname = expandPath(tool, args);
  const { query, headers } = routeParams(tool, args);
  const body = routeBody(tool, args);

  const url = new URL(pathname, config.baseUrl);
  for (const [key, value] of query) url.searchParams.set(key, value);

  // Carry the proxy origin as the standard reverse-proxy forwarded headers. The
  // wrapped endpoint's auth guard re-derives the request origin (to check the
  // access token's `aud`) WITHOUT a request object, so it can only see the origin
  // through these headers. `baseUrl` is exactly the origin the token was minted
  // and transport-verified against, so forwarding its scheme+host makes the
  // wrapped guard reconstruct the SAME origin — the `aud` survives the replay in
  // both dev (http) and prod (any proxied https origin). Omitting them let the
  // guard default the scheme to https and 401 a valid http-minted bearer.
  const base = new URL(config.baseUrl);

  const init: RequestInit = {
    method: tool.method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.bearer}`,
      "x-forwarded-proto": base.protocol.replace(/:$/, ""),
      "x-forwarded-host": base.host,
      ...headers,
    },
  };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await doFetch(url.toString(), init);
  const text = await response.text();
  let parsed: unknown = text;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return { status: response.status, ok: response.ok, body: parsed };
}
