import type { ChatFetch } from "../client/api";
import type { ChatAccess } from "../server/context";
import { createApiChat } from "../server/index";
import { configWith } from "./fixtures";

/**
 * The surface under test talks to the REAL routes over an in-memory db: the
 * fetch the host would supply is the only fake, and it dispatches to the route
 * descriptors exactly as a host adapter would.
 */
export function routedFetch(actor: () => ChatAccess | null, overrides: Parameters<typeof configWith>[0] = {}) {
  const { config, db } = configWith(overrides);
  const { routes } = createApiChat(config);
  const calls: string[] = [];
  const fetch: ChatFetch = async (url, init) => {
    const path = url.replace(/^\/thread/, "") || "/";
    calls.push(`${init.method} ${path}`);
    const route = routes.find((candidate) => candidate.method === init.method && candidate.path === path);
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    const response = await route.handle({
      actor: actor(),
      params: {},
      query: {},
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    return { ok: response.status < 400, status: response.status, json: async () => response.body };
  };
  return { fetch, db, calls };
}

export const formatTime = (iso: string): string => iso.slice(11, 16);
