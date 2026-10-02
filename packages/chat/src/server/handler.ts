/**
 * What every route shares: the response shapes, resolving the caller's place
 * in the thread, finding the thread row, and the wire form of a message.
 *
 * Every 2xx answers `{ data }` — the house envelope the other server packages
 * answer with — and every refusal answers `{ error, message }`: the machine
 * code is the package's, the sentence is the host's.
 */

import type { ChatWireMessage } from "../core/types";
import type { ChatAccess, ChatRequest, ChatResponse, ChatRoleConfig, ChatServerConfig } from "./context";
import { resolveCompleteCopy, type ChatServerCopy } from "./copy";
import type { ChatDb, ChatMessageRow, ChatThreadRow } from "./db";

export function success(status: number, data: unknown): ChatResponse {
  return { status, body: { data } };
}

export function failure(status: number, error: string, message: string): ChatResponse {
  return { status, body: { error, message } };
}

export interface Resolved {
  readonly access: ChatAccess;
  readonly role: ChatRoleConfig;
  readonly copy: ChatServerCopy;
}

/** The caller's place in the thread, or the refusal to answer with. */
export async function resolve<TActor>(
  config: ChatServerConfig<TActor>,
  request: ChatRequest<TActor>,
): Promise<Resolved | ChatResponse> {
  const copy = resolveCompleteCopy(config.copy, request.locale);
  const access = await config.authorize(request);
  if (!access) return failure(404, "not_found", copy.notFound);
  const role = config.roles[access.role];
  if (!role) throw new Error(`@12-apps/chat: authorize answered role "${access.role}", which roles does not declare.`);
  return { access, role, copy };
}

export function isResponse(value: object): value is ChatResponse {
  return "status" in value;
}

function threadKeyOf(access: ChatAccess): { tenantId_threadKey: { tenantId: string; threadKey: string } } {
  return { tenantId_threadKey: { tenantId: access.tenantId, threadKey: access.threadKey } };
}

/** The thread, if anyone ever wrote in it. Reading never creates one. */
export function findThread(db: ChatDb, access: ChatAccess): Promise<ChatThreadRow | null> {
  return db.chatThread.findUnique({ where: threadKeyOf(access) });
}

/**
 * The thread, created on the first message. Two first messages at the same
 * instant race on the unique key, and the loser's client throws — whatever
 * its error code (the seam relies on none): the winner's row is then there,
 * so read it back, and rethrow only when it is not.
 */
export async function openThread(db: ChatDb, access: ChatAccess): Promise<ChatThreadRow> {
  try {
    return await db.chatThread.upsert({
      where: threadKeyOf(access),
      create: { tenantId: access.tenantId, threadKey: access.threadKey },
      update: {},
    });
  } catch (error) {
    const winner = await findThread(db, access);
    if (winner) return winner;
    throw error;
  }
}

function isMine(row: ChatMessageRow, access: ChatAccess, role: ChatRoleConfig): boolean {
  if (row.authorRole !== access.role) return false;
  return role.shared || row.authorId === access.authorId;
}

export function wireMessage<TActor>(config: ChatServerConfig<TActor>, row: ChatMessageRow, resolved: Resolved): ChatWireMessage {
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

/**
 * Run a host hook without making the caller wait for it or fail by it: the
 * message is committed, and a push provider's latency or outage is the
 * host's. A throw (or a rejected promise) goes to `onError`, when given.
 */
export function inBackground<TActor>(config: ChatServerConfig<TActor>, hook: string, run: () => unknown): void {
  const report = (error: unknown): void => {
    try {
      config.onError?.(error, { hook });
    } catch {
      // A failing error reporter has nowhere left to report to.
    }
  };
  try {
    void Promise.resolve(run()).catch(report);
  } catch (error) {
    report(error);
  }
}
