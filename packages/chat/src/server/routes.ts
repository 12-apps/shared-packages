/**
 * The three framework-neutral endpoints, mount-relative. The host mounts them
 * once per audience (each with its own `authorize`) under whatever path names
 * the subject — the package never sees what a thread is about.
 *
 * Every handler resolves `config.copy` against `request.locale` itself: the
 * routes are built once per process, and a copy resolved at build time would
 * answer every reader in one language for the life of the process.
 */

import { detectContactInfo } from "../core/contact";
import type { ChatThreadPayload, ChatWireMessage } from "../core/types";
import type { ChatAccess, ChatRequest, ChatResponse, ChatRoleConfig, ChatRoute, ChatServerConfig } from "./context";
import { resolveCopy, type ChatServerCopy } from "./copy";
import type { ChatDb, ChatMessageRow, ChatThreadRow } from "./db";
import { createSlidingWindow, type SlidingWindow } from "./rate";

const DEFAULT_HISTORY = 200;

function reply(status: number, body: unknown): ChatResponse {
  return { status, body };
}

function failure(status: number, error: string, message: string): ChatResponse {
  return reply(status, { error, message });
}

interface Resolved {
  readonly access: ChatAccess;
  readonly role: ChatRoleConfig;
  readonly copy: ChatServerCopy;
}

/** The caller's place in the thread, or the refusal to answer with. */
async function resolve<TActor>(
  config: ChatServerConfig<TActor>,
  request: ChatRequest<TActor>,
): Promise<Resolved | ChatResponse> {
  const copy = resolveCopy(config.copy, request.locale);
  const access = await config.authorize(request);
  if (!access) return failure(404, "not_found", copy.notFound);
  const role = config.roles[access.role];
  if (!role) throw new Error(`@12-apps/chat: authorize answered role "${access.role}", which roles does not declare.`);
  return { access, role, copy };
}

function isResponse(value: Resolved | ChatResponse): value is ChatResponse {
  return "status" in value;
}

function threadKeyOf(access: ChatAccess): { tenantId_threadKey: { tenantId: string; threadKey: string } } {
  return { tenantId_threadKey: { tenantId: access.tenantId, threadKey: access.threadKey } };
}

async function openThread(db: ChatDb, access: ChatAccess): Promise<ChatThreadRow> {
  return db.chatThread.upsert({
    where: threadKeyOf(access),
    create: { tenantId: access.tenantId, threadKey: access.threadKey },
    update: {},
  });
}

function isMine(row: ChatMessageRow, access: ChatAccess, role: ChatRoleConfig): boolean {
  if (row.authorRole !== access.role) return false;
  return role.shared || row.authorId === access.authorId;
}

function wireMessage<TActor>(
  config: ChatServerConfig<TActor>,
  row: ChatMessageRow,
  resolved: Resolved,
): ChatWireMessage {
  return {
    id: row.id,
    role: row.authorRole,
    // A role the host has since removed still shows as its key, never a blank.
    label: config.roles[row.authorRole]?.label ?? row.authorRole,
    mine: isMine(row, resolved.access, resolved.role),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

async function unreadFor(db: ChatDb, thread: ChatThreadRow, access: ChatAccess): Promise<number> {
  const marker = await db.chatReadMarker.findUnique({
    where: { threadId_role_readerId: { threadId: thread.id, role: access.role, readerId: access.readerId } },
  });
  return db.chatMessage.count({
    where: {
      threadId: thread.id,
      authorRole: { not: access.role },
      ...(marker ? { createdAt: { gt: marker.lastReadAt } } : {}),
    },
  });
}

function threadRoute<TActor>(config: ChatServerConfig<TActor>): ChatRoute<TActor> {
  return {
    method: "GET",
    path: "/",
    async handle(request) {
      const resolved = await resolve(config, request);
      if (isResponse(resolved)) return resolved;
      const db = await config.db();
      const thread = await openThread(db, resolved.access);
      const newestFirst = await db.chatMessage.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: "desc" },
        take: config.historyLimit ?? DEFAULT_HISTORY,
      });
      const payload: ChatThreadPayload = {
        thread: {
          me: { role: resolved.access.role, label: resolved.role.label },
          canWrite: resolved.access.canWrite,
          freeText: resolved.role.freeText,
          maxLength: resolved.role.maxLength,
          quickReplies: resolved.role.quickReplies,
        },
        messages: [...newestFirst].reverse().map((row) => wireMessage(config, row, resolved)),
        unread: await unreadFor(db, thread, resolved.access),
      };
      return reply(200, payload);
    },
  };
}

type Draft = { body: string; quickKey: string | null };
type Refuse = (status: number, error: string, message: string) => ChatResponse;

function quickDraftOf(quickReply: unknown, { role, copy }: Resolved, refuse: Refuse): Draft | ChatResponse {
  const found = typeof quickReply === "string" ? role.quickReplies.find((entry) => entry.key === quickReply) : undefined;
  return found ? { body: found.text, quickKey: found.key } : refuse(422, "unknown_quick_reply", copy.unknownQuickReply);
}

function textDraftOf(text: unknown, { role, copy }: Resolved, refuse: Refuse): Draft | ChatResponse {
  if (typeof text !== "string") return refuse(422, "invalid_body", copy.invalidBody);
  if (!role.freeText) return refuse(422, "free_text_disabled", copy.freeTextDisabled);
  const trimmed = text.trim();
  if (trimmed === "") return refuse(422, "empty", copy.empty);
  if (trimmed.length > role.maxLength) return refuse(422, "too_long", copy.tooLong.replace("{max}", String(role.maxLength)));
  return { body: trimmed, quickKey: null };
}

/** What the body asks to send — a quick reply by key, or free text — or the refusal. */
function draftOf(body: unknown, resolved: Resolved, refuse: Refuse): Draft | ChatResponse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return refuse(422, "invalid_body", resolved.copy.invalidBody);
  }
  const { body: text, quickReply } = body as { body?: unknown; quickReply?: unknown };
  return quickReply !== undefined ? quickDraftOf(quickReply, resolved, refuse) : textDraftOf(text, resolved, refuse);
}

function isDraft(value: Draft | ChatResponse): value is Draft {
  return "quickKey" in value;
}

/** Content rules for free text; quick replies are the host's own words and pass. */
function contentRefusal<TActor>(config: ChatServerConfig<TActor>, draft: Draft, resolved: Resolved): ChatResponse | null {
  if (draft.quickKey !== null) return null;
  const found = detectContactInfo(draft.body, resolved.role.blockContact, config.contactVocabulary);
  return found.length > 0 ? failure(422, "contact_info", resolved.copy.contactInfo) : null;
}

async function notify<TActor>(config: ChatServerConfig<TActor>, access: ChatAccess, row: ChatMessageRow, label: string): Promise<void> {
  if (!config.onMessage) return;
  try {
    await config.onMessage({
      tenantId: access.tenantId,
      threadKey: access.threadKey,
      message: {
        id: row.id,
        role: row.authorRole,
        label,
        authorId: row.authorId,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      },
    });
  } catch {
    // The message is committed; a host hook that fails must not turn the send red.
  }
}

function sendRoute<TActor>(config: ChatServerConfig<TActor>, limiter: SlidingWindow): ChatRoute<TActor> {
  const clock = config.clock ?? (() => new Date());
  return {
    method: "POST",
    path: "/messages",
    async handle(request) {
      const resolved = await resolve(config, request);
      if (isResponse(resolved)) return resolved;
      const { access, role, copy } = resolved;
      if (!access.canWrite) return failure(403, "closed", copy.closed);
      const draft = draftOf(request.body, resolved, failure);
      if (!isDraft(draft)) return draft;
      const refused = contentRefusal(config, draft, resolved);
      if (refused) return refused;
      const now = clock();
      const key = `${access.tenantId}|${access.threadKey}|${access.role}|${access.authorId}`;
      if (!limiter.take(key, role.rateLimit.max, role.rateLimit.windowMs, now.getTime())) {
        return failure(429, "rate_limited", copy.rateLimited);
      }
      const db = await config.db();
      const thread = await openThread(db, access);
      const row = await db.chatMessage.create({
        data: {
          threadId: thread.id,
          tenantId: access.tenantId,
          authorRole: access.role,
          authorId: access.authorId,
          body: draft.body,
          quickKey: draft.quickKey,
          createdAt: now,
        },
      });
      await db.chatThread.update({ where: { id: thread.id }, data: { lastMessageAt: row.createdAt } });
      await notify(config, access, row, role.label);
      return reply(201, { message: wireMessage(config, row, resolved) });
    },
  };
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
      const thread = await openThread(db, access);
      const at = clock();
      await db.chatReadMarker.upsert({
        where: { threadId_role_readerId: { threadId: thread.id, role: access.role, readerId: access.readerId } },
        create: { threadId: thread.id, role: access.role, readerId: access.readerId, lastReadAt: at },
        update: { lastReadAt: at },
      });
      return reply(200, { unread: 0 });
    },
  };
}

export function chatRoutes<TActor>(config: ChatServerConfig<TActor>): ChatRoute<TActor>[] {
  const limiter = createSlidingWindow();
  return [threadRoute(config), sendRoute(config, limiter), readRoute(config)];
}
