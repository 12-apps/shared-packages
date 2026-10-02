/**
 * The thread's HTTP client — platform-free, so the web and the native surface
 * share it. The host supplies `fetch`: its credentials (a session cookie, a
 * Bearer link) are the host's, and so is the base URL of the mounted routes.
 */

import type { ChatErrorCode, ChatThreadPayload, ChatWireMessage } from "../core/types";

/** The subset of `fetch` this client uses — the platform's own, or a host wrapper. */
export type ChatFetch = (
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** A refused or failed call. `status` 0 means the request never reached the server. */
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
  markRead(): Promise<void>;
}

function errorOf(status: number, body: unknown): ChatClientError {
  const shaped = typeof body === "object" && body !== null ? (body as { error?: unknown; message?: unknown }) : {};
  return new ChatClientError(
    status,
    typeof shaped.error === "string" ? (shaped.error as ChatErrorCode) : null,
    typeof shaped.message === "string" ? shaped.message : null,
  );
}

/** Unwrap a `{ data: … }` envelope when the host's adapter adds one. */
function unwrap(body: unknown): unknown {
  if (typeof body === "object" && body !== null && "data" in body && !("thread" in body) && !("message" in body)) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/**
 * `endpoint` is the mount of the three routes for ONE thread
 * (`…/threads/abc/chat`): `GET endpoint`, `POST endpoint/messages`,
 * `POST endpoint/read`.
 */
export function createChatClient(options: { fetch: ChatFetch; endpoint: string }): ChatClient {
  const base = options.endpoint.replace(/\/+$/, "");
  const call = async (path: string, method: "GET" | "POST", payload?: unknown): Promise<unknown> => {
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
    if (!response.ok) throw errorOf(response.status, unwrap(body));
    return unwrap(body);
  };
  return {
    load: async () => (await call("", "GET")) as ChatThreadPayload,
    send: async (input) => ((await call("/messages", "POST", input)) as { message: ChatWireMessage }).message,
    markRead: async () => {
      await call("/read", "POST", {});
    },
  };
}
