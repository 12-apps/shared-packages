/**
 * The three framework-neutral endpoints, mount-relative. The host mounts them
 * once per audience (each with its own `authorize`) under whatever path names
 * the subject — the package never sees what a thread is about.
 *
 * Every handler resolves `config.copy` against `request.locale` itself: the
 * routes are built once per process, and a copy resolved at build time would
 * answer every reader in one language for the life of the process.
 *
 * Reading never writes a thread row: a thread exists once somebody wrote in
 * it, so a read-only viewer opening an empty one leaves nothing behind.
 */

import type { ChatThreadPayload } from "../core/types";
import type { ChatAccess, ChatRoute, ChatServerConfig } from "./context";
import type { ChatDb, ChatThreadRow } from "./db";
import { findThread, isResponse, resolve, success, wireMessage, type Resolved } from "./handler";
import { createSlidingWindow } from "./rate";
import { sendRoute } from "./send";

const DEFAULT_HISTORY = 200;

function markerKeyOf(thread: ChatThreadRow, access: ChatAccess) {
  return { threadId_role_readerId: { threadId: thread.id, role: access.role, readerId: access.readerId } };
}

async function unreadFor(db: ChatDb, thread: ChatThreadRow, access: ChatAccess): Promise<number> {
  const marker = await db.chatReadMarker.findUnique({ where: markerKeyOf(thread, access) });
  return db.chatMessage.count({
    where: {
      threadId: thread.id,
      authorRole: { not: access.role },
      ...(marker ? { createdAt: { gt: marker.lastReadAt } } : {}),
    },
  });
}

function threadOf(resolved: Resolved): ChatThreadPayload["thread"] {
  return {
    me: { role: resolved.access.role, label: resolved.role.label },
    canWrite: resolved.access.canWrite,
    freeText: resolved.role.freeText,
    maxLength: resolved.role.maxLength,
    quickReplies: resolved.role.quickReplies,
  };
}

function threadRoute<TActor>(config: ChatServerConfig<TActor>): ChatRoute<TActor> {
  return {
    method: "GET",
    path: "/",
    async handle(request) {
      const resolved = await resolve(config, request);
      if (isResponse(resolved)) return resolved;
      const db = await config.db();
      const thread = await findThread(db, resolved.access);
      if (!thread) return success(200, { thread: threadOf(resolved), messages: [], unread: 0 } satisfies ChatThreadPayload);
      // `id` breaks ties: two messages in the same millisecond keep one order on every read.
      const newestFirst = await db.chatMessage.findMany({
        where: { threadId: thread.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: config.historyLimit ?? DEFAULT_HISTORY,
      });
      const payload: ChatThreadPayload = {
        thread: threadOf(resolved),
        messages: [...newestFirst].reverse().map((row) => wireMessage(config, row, resolved)),
        unread: await unreadFor(db, thread, resolved.access),
      };
      return success(200, payload);
    },
  };
}

/**
 * How far the reader has seen: the `upTo` the client sends (the newest
 * message it SHOWED), never past now — so a message that arrived after the
 * screen last loaded stays unread instead of being marked read unseen.
 */
function seenUpTo(body: unknown, now: Date): Date {
  const upTo = typeof body === "object" && body !== null ? (body as { upTo?: unknown }).upTo : undefined;
  const at = typeof upTo === "string" ? new Date(upTo) : null;
  if (!at || Number.isNaN(at.getTime())) return now;
  return at.getTime() < now.getTime() ? at : now;
}

async function moveMarker(db: ChatDb, thread: ChatThreadRow, access: ChatAccess, at: Date): Promise<void> {
  const where = markerKeyOf(thread, access);
  const current = await db.chatReadMarker.findUnique({ where });
  // Never backwards: a slow tab reporting an older screen does not un-read what another tab read.
  if (current && current.lastReadAt.getTime() >= at.getTime()) return;
  await db.chatReadMarker.upsert({
    where,
    create: { threadId: thread.id, role: access.role, readerId: access.readerId, lastReadAt: at },
    update: { lastReadAt: at },
  });
}

function readRoute<TActor>(config: ChatServerConfig<TActor>): ChatRoute<TActor> {
  const clock = config.clock ?? (() => new Date());
  return {
    method: "POST",
    path: "/read",
    async handle(request) {
      const resolved = await resolve(config, request);
      if (isResponse(resolved)) return resolved;
      const { access } = resolved;
      const db = await config.db();
      const thread = await findThread(db, access);
      if (!thread) return success(200, { unread: 0 });
      await moveMarker(db, thread, access, seenUpTo(request.body, clock()));
      return success(200, { unread: await unreadFor(db, thread, access) });
    },
  };
}

export function chatRoutes<TActor>(config: ChatServerConfig<TActor>): ChatRoute<TActor>[] {
  const limiter = createSlidingWindow();
  return [threadRoute(config), sendRoute(config, limiter), readRoute(config)];
}
