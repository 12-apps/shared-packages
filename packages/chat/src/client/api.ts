/**
 * The thread's HTTP client — platform-free, so the web and the native surface
 * share it. The host supplies `fetch`: its credentials (a session cookie, a
 * Bearer link) are the host's, and so is the base URL of the mounted routes.
 *
 * The wire is strict: every 2xx body is `{ data: X }`, every refusal
 * `{ error, message }` with a 4xx status. A body that is not that shape is
 * refused HERE, as a {@link ChatClientError} with `code: null` — so a broken
 * adapter surfaces as a load or send failure, never as a crash while drawing.
 */

import type { ChatErrorCode, ChatThreadPayload, ChatWireMessage } from "../core/types";

/** The subset of `fetch` this client uses — the platform's own, or a host wrapper. */
export type ChatFetch = (
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * A refused or failed call. `status` 0 means the request never reached the
 * server; a 2xx `status` with `code: null` means the body was not the wire shape.
 */
export class ChatClientError extends Error {
  readonly status: number;
  readonly code: ChatErrorCode | null;
  /** The server's own sentence for the refusal (host copy), when it sent one. */
  readonly serverMessage: string | null;

  constructor(status: number, code: ChatErrorCode | null, serverMessage: string | null) {
    super(`chat request failed (${status}${code ? ` ${code}` : ""})`);
    this.name = "ChatClientError";
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
  }
}

export type ChatSendInput = { readonly body: string } | { readonly quickReply: string };

export interface ChatClient {
  load(): Promise<ChatThreadPayload>;
  send(input: ChatSendInput): Promise<ChatWireMessage>;
  /**
   * Mark the thread read up to `upTo` — the `createdAt` of the newest message
   * the viewer was SHOWN. Resolves to the unread count the server has left.
   */
  markRead(upTo: string): Promise<number>;
}

type Shape = Record<string, unknown>;

const isRecord = (value: unknown): value is Shape => typeof value === "object" && value !== null && !Array.isArray(value);

function errorOf(status: number, body: unknown): ChatClientError {
  const shaped = isRecord(body) ? body : {};
  return new ChatClientError(
    status,
    typeof shaped.error === "string" ? (shaped.error as ChatErrorCode) : null,
    typeof shaped.message === "string" ? shaped.message : null,
  );
}

const malformed = (status: number): ChatClientError => new ChatClientError(status, null, null);

function isMessage(value: unknown): value is ChatWireMessage {
  if (!isRecord(value)) return false;
  const strings = [value.id, value.role, value.label, value.body, value.createdAt].every((field) => typeof field === "string");
  return strings && typeof value.mine === "boolean";
}

function isQuickReply(value: unknown): boolean {
  return isRecord(value) && typeof value.key === "string" && typeof value.text === "string";
}

function isThread(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.me)) return false;
  const flags = typeof value.canWrite === "boolean" && typeof value.freeText === "boolean";
  return flags && typeof value.maxLength === "number" && Array.isArray(value.quickReplies) && value.quickReplies.every(isQuickReply);
}

function isPayload(value: unknown): value is ChatThreadPayload {
  if (!isRecord(value) || !isThread(value.thread) || typeof value.unread !== "number") return false;
  return Array.isArray(value.messages) && value.messages.every(isMessage);
}

/** The `X` of a `{ data: X }` body that passes `accept`, or a refusal carrying the response's status. */
function dataOf<T>(status: number, body: unknown, accept: (data: unknown) => data is T): T {
  if (!isRecord(body) || !accept(body.data)) throw malformed(status);
  return body.data;
}

const isSent = (data: unknown): data is { message: ChatWireMessage } => isRecord(data) && isMessage(data.message);
const isRead = (data: unknown): data is { unread: number } => isRecord(data) && typeof data.unread === "number";

/** Drop trailing `/`s with one backward scan — no regex to backtrack on. */
function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

interface ChatResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * `endpoint` is the mount of the three routes for ONE thread
 * (`…/threads/abc/chat`): `GET endpoint`, `POST endpoint/messages`,
 * `POST endpoint/read`.
 */
export function createChatClient(options: { fetch: ChatFetch; endpoint: string }): ChatClient {
  const base = trimTrailingSlashes(options.endpoint);
  const call = async (path: string, method: "GET" | "POST", payload?: unknown): Promise<ChatResponse> => {
    let response: Awaited<ReturnType<ChatFetch>>;
    try {
      response = await options.fetch(`${base}${path}`, {
        method,
        headers: payload === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    } catch {
      throw new ChatClientError(0, null, null);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw errorOf(response.status, body);
    return { status: response.status, body };
  };
  return {
    load: async () => {
      const response = await call("", "GET");
      return dataOf(response.status, response.body, isPayload);
    },
    send: async (input) => {
      const response = await call("/messages", "POST", input);
      return dataOf(response.status, response.body, isSent).message;
    },
    markRead: async (upTo) => {
      const response = await call("/read", "POST", { upTo });
      return dataOf(response.status, response.body, isRead).unread;
    },
  };
}
