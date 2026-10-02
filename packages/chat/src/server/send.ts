/**
 * `POST /messages` — the one write, and the order its checks run in:
 *
 *   1. who may write here (`canWrite`);
 *   2. what the body asks to send — a quick reply by key, or free text;
 *   3. the rate limit, BEFORE the content rules, so a refused attempt still
 *      spends a slot: a role probing the contact filter with one encoding
 *      after another runs out of attempts instead of running the filter for
 *      free;
 *   4. the content rules, on the draft alone and on the draft joined to the
 *      author's own recent free text, so a number split across messages is
 *      the same number. A refusal is reported to the host (`onRefused`): a
 *      person who keeps trying is the host's to see.
 */

import { detectContactInfoAcross, type ContactKind } from "../core/contact";
import type { ChatAccess, ChatRoute, ChatServerConfig } from "./context";
import type { ChatDb, ChatMessageRow } from "./db";
import { failure, findThread, inBackground, isResponse, openThread, resolve, success, wireMessage, type Resolved } from "./handler";
import type { ChatResponse } from "./context";
import type { SlidingWindow } from "./rate";

/**
 * The author's own recent free text the contact rules read with a draft —
 * deep enough that a number trickled one digit per message still fits.
 */
const DEFAULT_LOOKBACK = { messages: 12, windowMs: 10 * 60_000 } as const;

/**
 * Characters that draw nothing: format characters (zero-width spaces,
 * joiners, bidi marks), the fillers that are letters to Unicode but blank on
 * screen (Hangul fillers, the braille blank, Khmer inherent vowels), the
 * grapheme joiner and the variation selectors.
 */
// The combining ones (grapheme joiner, Khmer inherent vowels, variation selectors) sit outside the class, where they cannot attach to a neighbour.
const INVISIBLE = /[\p{Cf}\u115F\u1160\u2800\u3164\uFFA0]|\u034F|\u17B4|\u17B5|\p{Variation_Selector}/gu;

/**
 * Bidi controls, removed before a message is STORED: an override makes the
 * screen show text in another order than the one the filter read
 * (`\u202Emoc.liamg@ana` reads as nothing and shows an address).
 */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

type Draft = { body: string; quickKey: string | null };

function quickDraftOf(quickReply: unknown, { role, copy }: Resolved): Draft | ChatResponse {
  const found = typeof quickReply === "string" ? role.quickReplies.find((entry) => entry.key === quickReply) : undefined;
  return found ? { body: found.text, quickKey: found.key } : failure(422, "unknown_quick_reply", copy.unknownQuickReply);
}

function textDraftOf(text: unknown, { role, copy }: Resolved): Draft | ChatResponse {
  if (typeof text !== "string") return failure(422, "invalid_body", copy.invalidBody);
  if (!role.freeText) return failure(422, "free_text_disabled", copy.freeTextDisabled);
  const trimmed = text.replace(BIDI_CONTROLS, "").trim();
  // Stored otherwise as typed (an emoji's joiners are format characters too),
  // but a message of nothing BUT invisible characters is an empty bubble.
  if (trimmed.replace(INVISIBLE, "").trim() === "") return failure(422, "empty", copy.empty);
  if (trimmed.length > role.maxLength) return failure(422, "too_long", copy.tooLong.replace("{max}", String(role.maxLength)));
  return { body: trimmed, quickKey: null };
}

/** What the body asks to send — a quick reply by key, or free text — or the refusal. */
function draftOf(body: unknown, resolved: Resolved): Draft | ChatResponse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return failure(422, "invalid_body", resolved.copy.invalidBody);
  }
  const { body: text, quickReply } = body as { body?: unknown; quickReply?: unknown };
  // `null` reads as absent: a client that always sends both keys is not asking for a quick reply.
  return quickReply !== undefined && quickReply !== null ? quickDraftOf(quickReply, resolved) : textDraftOf(text, resolved);
}

/** The author's own free text inside the lookback, oldest first. */
async function recentTextOf<TActor>(config: ChatServerConfig<TActor>, db: ChatDb, access: ChatAccess, now: Date): Promise<string[]> {
  const lookback = config.contactLookback ?? DEFAULT_LOOKBACK;
  const thread = await findThread(db, access);
  if (!thread) return [];
  const rows = await db.chatMessage.findMany({
    where: {
      threadId: thread.id,
      authorRole: access.role,
      authorId: access.authorId,
      quickKey: null,
      createdAt: { gt: new Date(now.getTime() - lookback.windowMs) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: lookback.messages,
  });
  return rows.map((row) => row.body).reverse();
}

/** Contact kinds the draft carries, alone or with the author's recent text; `[]` when it may go. */
async function contactIn<TActor>(config: ChatServerConfig<TActor>, db: ChatDb, draft: Draft, resolved: Resolved, now: Date): Promise<ContactKind[]> {
  const blocked = resolved.role.blockContact;
  // Quick replies are the host's own words, and a role that blocks nothing is not scanned.
  if (draft.quickKey !== null || blocked.length === 0) return [];
  const recent = await recentTextOf(config, db, resolved.access, now);
  return detectContactInfoAcross(recent, draft.body, blocked, config.contactVocabulary);
}

function refuseContact<TActor>(config: ChatServerConfig<TActor>, resolved: Resolved, kinds: ContactKind[]): ChatResponse {
  const { access } = resolved;
  if (config.onRefused) {
    const onRefused = config.onRefused;
    inBackground(config, "onRefused", () =>
      onRefused({ tenantId: access.tenantId, threadKey: access.threadKey, role: access.role, authorId: access.authorId, code: "contact_info", kinds }),
    );
  }
  return failure(422, "contact_info", resolved.copy.contactInfo);
}

function notify<TActor>(config: ChatServerConfig<TActor>, access: ChatAccess, row: ChatMessageRow, label: string): void {
  const onMessage = config.onMessage;
  if (!onMessage) return;
  inBackground(config, "onMessage", () =>
    onMessage({
      tenantId: access.tenantId,
      threadKey: access.threadKey,
      message: {
        id: row.id,
        role: row.authorRole,
        label,
        authorId: row.authorId,
        body: row.body,
        quickKey: row.quickKey,
        createdAt: row.createdAt.toISOString(),
      },
    }),
  );
}

/** One key per author per thread; JSON so no id can contain the separator. */
function rateKeyOf(access: ChatAccess): string {
  return JSON.stringify([access.tenantId, access.threadKey, access.role, access.authorId]);
}

async function commit<TActor>(config: ChatServerConfig<TActor>, db: ChatDb, draft: Draft, resolved: Resolved): Promise<ChatResponse> {
  const { access, role } = resolved;
  // Stamped at the insert, not at the request: a message must not carry an
  // earlier time than one a reader has already seen (and marked read up to).
  const now = (config.clock ?? (() => new Date()))();
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
  notify(config, access, row, role.label);
  return success(201, { message: wireMessage(config, row, resolved) });
}

/**
 * One author's sends to one thread run one at a time, in this process, so
 * each is checked against the ones before it — parallel requests cannot all
 * pass the cross-message rule against each other's absence. Several
 * processes can still interleave; the rule is a deterrent, not a lock.
 */
function serialised(): (key: string, run: () => Promise<ChatResponse>) => Promise<ChatResponse> {
  const tails = new Map<string, Promise<unknown>>();
  return (key, run) => {
    const result = (tails.get(key) ?? Promise.resolve()).then(run, run);
    const tail = result.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}

export function sendRoute<TActor>(config: ChatServerConfig<TActor>, limiter: SlidingWindow): ChatRoute<TActor> {
  const clock = config.clock ?? (() => new Date());
  const inTurn = serialised();
  return {
    method: "POST",
    path: "/messages",
    async handle(request) {
      const resolved = await resolve(config, request);
      if (isResponse(resolved)) return resolved;
      const { access, role, copy } = resolved;
      if (!access.canWrite) return failure(403, "closed", copy.closed);
      const draft = draftOf(request.body, resolved);
      if (isResponse(draft)) return draft;
      const now = clock();
      if (!limiter.take(rateKeyOf(access), role.rateLimit.max, role.rateLimit.windowMs, now.getTime())) {
        return failure(429, "rate_limited", copy.rateLimited);
      }
      const db = await config.db();
      return inTurn(rateKeyOf(access), async () => {
        const kinds = await contactIn(config, db, draft, resolved, now);
        if (kinds.length > 0) return refuseContact(config, resolved, kinds);
        return commit(config, db, draft, resolved);
      });
    },
  };
}
