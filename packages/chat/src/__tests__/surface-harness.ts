import type { ChatFetch } from "../client/api";
import type { ChatAccess } from "../server/context";
import { createApiChat } from "../server/index";
import { configWith } from "./fixtures";

type FetchReply = Awaited<ReturnType<ChatFetch>>;

/** A canned response, for a call the test answers itself instead of the routes. */
export const replyWith = (status: number, body: unknown): FetchReply => ({ ok: status < 400, status, json: async () => body });

/**
 * The surface under test talks to the REAL routes over an in-memory db: the
 * fetch the host would supply is the only fake, and it dispatches to the route
 * descriptors exactly as a host adapter would. The endpoint's first path
 * segment is the mount (`/thread`, `/a`, …); the rest picks the route.
 *
 * `hold("GET /")` makes the NEXT such call run against the routes at once but
 * answer only when the returned release is called — a slow response, ordered
 * by the test. `answer(key, reply)` replaces every such call's response.
 */
export function routedFetch(actor: () => ChatAccess | null, overrides: Parameters<typeof configWith>[0] = {}) {
  const { config, db } = configWith(overrides);
  const { routes } = createApiChat(config);
  const calls: string[] = [];
  const bodies: { key: string; body: unknown }[] = [];
  const gates = new Map<string, Promise<void>>();
  const answers = new Map<string, FetchReply>();

  const dispatch = async (method: string, path: string, body: unknown): Promise<FetchReply> => {
    const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
    if (!route) return replyWith(404, {});
    const response = await route.handle({ actor: actor(), params: {}, query: {}, body });
    return replyWith(response.status, response.body);
  };

  const fetch: ChatFetch = async (url, init) => {
    const key = `${init.method} ${url.replace(/^\/[^/]*/, "") || "/"}`;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push(key);
    bodies.push({ key, body });
    const response = answers.get(key) ?? (await dispatch(init.method, key.slice(init.method.length + 1), body));
    const gate = gates.get(key);
    gates.delete(key);
    await gate;
    return response;
  };

  const hold = (key: string): (() => void) => {
    const latch: { open?: () => void } = {};
    gates.set(
      key,
      new Promise<void>((resolve) => {
        latch.open = resolve;
      }),
    );
    return () => latch.open?.();
  };
  const answer = (key: string, reply: FetchReply): void => {
    answers.set(key, reply);
  };
  return { fetch, db, calls, bodies, hold, answer };
}

function openThreadRow(db: ReturnType<typeof configWith>["db"], threadKey: string) {
  const thread = { id: `thread-${threadKey}`, tenantId: "t1", threadKey, createdAt: new Date(0), lastMessageAt: null };
  db.threads.push(thread);
  return thread;
}

/** A message from another party, written straight into the store (the thread row too, when it is the first). */
export function seedMessage(
  db: ReturnType<typeof configWith>["db"],
  message: { id: string; body: string; createdAt: string; role?: string; threadKey?: string },
): void {
  const threadKey = message.threadKey ?? "job:1";
  const thread = db.threads.find((row) => row.threadKey === threadKey) ?? openThreadRow(db, threadKey);
  db.messages.push({
    id: message.id,
    threadId: thread.id,
    tenantId: "t1",
    authorRole: message.role ?? "agent",
    authorId: `u-${message.role ?? "agent"}`,
    body: message.body,
    quickKey: null,
    createdAt: new Date(message.createdAt),
  });
}

export const formatTime = (iso: string): string => iso.slice(11, 16);
