import { Hono } from "hono";
import type { Context } from "hono";

import {
  createApiMcpOauth,
  type ApiMcpOauth,
} from "../oauth/create-api-mcp-oauth";
import type { McpOauthConfig } from "../oauth/context";

/**
 * `@12-apps/mcp/hono` — the OAuth authorization server as a mountable router.
 *
 * Behind its own subpath with `hono` as an OPTIONAL peer (the report-builder / rbac
 * precedent), so a host on another framework — or one importing only the tool
 * generator — never resolves it.
 *
 * Mounted at the ORIGIN ROOT, because two of the six paths are `.well-known`
 * documents and a connector reads them from the origin, not from a prefix:
 *
 *   const oauth = mcpOauthRouter({ stores, resolveSession });
 *   app.route('/', oauth.router);
 *
 * The adapter is deliberately thin: each handler already answers a Fetch `Response`
 * (a 302 with a `Location`, RFC 6749 JSON, an RFC 8414 document), and those shapes
 * are fixed by specification — there is no envelope to apply, and applying one
 * would break every client.
 */
export interface McpOauthHono extends ApiMcpOauth {
  router: Hono;
}

export function mcpOauthRouter(config: McpOauthConfig): McpOauthHono {
  const api = createApiMcpOauth(config);
  const router = new Hono();

  for (const route of api.routes) {
    const handler = (c: Context): Promise<Response> => route.handle(c.req.raw);
    if (route.method === "GET") router.get(route.path, handler);
    else router.post(route.path, handler);
  }

  return { ...api, router };
}
