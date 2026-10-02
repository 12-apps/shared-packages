/**
 * The thread's state, platform-free: one hook both surfaces render.
 *
 * Loads on mount and again whenever `refreshSignal` changes — the host bumps it
 * when its live channel says the thread moved, so the package needs no socket
 * of its own. A reload keeps the messages on screen (no spinner after the
 * first). The thread is marked read whenever a load finds unread messages.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatThreadPayload, ChatWireMessage } from "../core/types";
import { ChatClientError, type ChatClient, type ChatSendInput } from "./api";

export type ChatThreadPhase = "loading" | "ready" | "error";

/** Why the last send failed: the server's own sentence, or a network failure (`message: null`). */
export interface ChatSendFailure {
  readonly code: string | null;
  readonly message: string | null;
}

export interface ChatThreadState {
  readonly phase: ChatThreadPhase;
  readonly payload: ChatThreadPayload | null;
  readonly sending: boolean;
  readonly sendFailure: ChatSendFailure | null;
}

export interface ChatThreadControls extends ChatThreadState {
  send(text: string): Promise<boolean>;
  sendQuickReply(key: string): Promise<boolean>;
  reload(): void;
}

function withMessage(payload: ChatThreadPayload, message: ChatWireMessage): ChatThreadPayload {
  if (payload.messages.some((existing) => existing.id === message.id)) return payload;
  return { ...payload, messages: [...payload.messages, message] };
}

function failureOf(error: unknown): ChatSendFailure {
  return error instanceof ChatClientError
    ? { code: error.code, message: error.serverMessage }
    : { code: null, message: null };
}

export function useChatThread(options: {
  client: ChatClient;
  refreshSignal?: unknown;
  /** Told the unread count each load found (before marking read), then 0 once read. */
  onUnreadChange?: (unread: number) => void;
}): ChatThreadControls {
  const { client, refreshSignal } = options;
  const [state, setState] = useState<ChatThreadState>({ phase: "loading", payload: null, sending: false, sendFailure: null });
  const generation = useRef(0);
  const onUnread = useRef(options.onUnreadChange);
  useEffect(() => {
    onUnread.current = options.onUnreadChange;
  }, [options.onUnreadChange]);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const payload = await client.load();
      if (mine !== generation.current) return;
      setState((previous) => ({ ...previous, phase: "ready", payload }));
      onUnread.current?.(payload.unread);
      if (payload.unread > 0) {
        await client.markRead().catch(() => undefined);
        onUnread.current?.(0);
      }
    } catch {
      if (mine !== generation.current) return;
      // A reload that fails keeps what is on screen; only a first load shows the error.
      setState((previous) => (previous.payload ? previous : { ...previous, phase: "error" }));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const deliver = useCallback(
    async (input: ChatSendInput): Promise<boolean> => {
      setState((previous) => ({ ...previous, sending: true, sendFailure: null }));
      try {
        const message = await client.send(input);
        setState((previous) => ({
          ...previous,
          sending: false,
          payload: previous.payload ? withMessage(previous.payload, message) : previous.payload,
        }));
        return true;
      } catch (error) {
        setState((previous) => ({ ...previous, sending: false, sendFailure: failureOf(error) }));
        return false;
      }
    },
    [client],
  );

  const send = useCallback((text: string) => deliver({ body: text }), [deliver]);
  const sendQuickReply = useCallback((key: string) => deliver({ quickReply: key }), [deliver]);
  const reload = useCallback(() => {
    setState((previous) => (previous.payload ? previous : { ...previous, phase: "loading" }));
    void load();
  }, [load]);

  return { ...state, send, sendQuickReply, reload };
}
