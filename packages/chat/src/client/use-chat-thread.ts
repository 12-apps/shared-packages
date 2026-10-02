/**
 * The thread's state, platform-free: one hook both surfaces render.
 *
 * Loads on mount and again whenever `refreshSignal` changes — the host bumps it
 * when its live channel says the thread moved, so the package needs no socket
 * of its own. A reload keeps the messages on screen (no spinner after the
 * first). Unless `autoMarkRead` is off, the thread is marked read up to the
 * newest message a load SHOWED whenever that load found unread messages. With
 * `autoMarkRead: "visible"` a load's unread wait until the list reports itself
 * on screen (`controls.onVisibleChange(true)`): a thread mounted below the fold
 * is marked read when it is scrolled to, not when it is mounted.
 *
 * Three races are closed here rather than left to the host:
 *  - a load that resolves after a send never drops the sent message: what is
 *    on screen and what a load returns are merged by id, never replaced;
 *  - a load overtaken by a newer one (or by a new `client`) is ignored;
 *  - a new `client` (another thread) shows nothing of the previous one, from
 *    the very render that receives it.
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
  /** The server's own sentence for a refused load (a gone thread, an expired session), when it sent one. */
  readonly loadFailure: string | null;
  readonly sending: boolean;
  readonly sendFailure: ChatSendFailure | null;
}

export interface ChatThreadControls extends ChatThreadState {
  send(text: string): Promise<boolean>;
  sendQuickReply(key: string): Promise<boolean>;
  reload(): void;
  /**
   * Set only with `autoMarkRead: "visible"`. The message list calls it with
   * whether it is on screen now, and with `false` when it unmounts; nothing is
   * marked read until it has said `true`.
   */
  readonly onVisibleChange?: (visible: boolean) => void;
}

/**
 * When the thread marks itself read: after each load that found unread
 * (`true`, the default), never (`false`, a hidden badge-only mount), or once
 * the message list is on screen (`"visible"`).
 */
export type ChatAutoMarkRead = boolean | "visible";

/** The state, tagged with the client (thread) it belongs to. */
interface OwnedState extends ChatThreadState {
  readonly owner: ChatClient;
}

const fresh = (owner: ChatClient): OwnedState => ({
  owner,
  phase: "loading",
  payload: null,
  loadFailure: null,
  sending: false,
  sendFailure: null,
});

/** The server's own order: oldest first, `id` breaking a tie. */
function byTime(a: ChatWireMessage, b: ChatWireMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Messages never leave a thread, so what is shown and what arrived are a union; the newer copy wins. */
function mergeMessages(shown: readonly ChatWireMessage[], arrived: readonly ChatWireMessage[]): ChatWireMessage[] {
  const byId = new Map(shown.map((message) => [message.id, message]));
  for (const message of arrived) byId.set(message.id, message);
  return [...byId.values()].sort(byTime);
}

function afterLoad(state: OwnedState, loaded: ChatThreadPayload): OwnedState {
  const payload = state.payload ? { ...loaded, messages: mergeMessages(state.payload.messages, loaded.messages) } : loaded;
  return { ...state, phase: "ready", loadFailure: null, payload };
}

/** Refusals that mean the thread is no longer readable by this caller. */
const UNREADABLE = new Set([401, 403, 404]);

function afterLoadFailure(state: OwnedState, error: unknown): OwnedState {
  const refusal = error instanceof ChatClientError ? error : null;
  // A reload lost to the network keeps what is on screen; a refused one does not.
  if (state.payload && !(refusal && UNREADABLE.has(refusal.status))) return state;
  return { ...state, phase: "error", payload: null, loadFailure: refusal?.serverMessage ?? null };
}

function afterSendFailure(state: OwnedState, error: unknown): OwnedState {
  const refusal = error instanceof ChatClientError ? error : null;
  const sendFailure = { code: refusal?.code ?? null, message: refusal?.serverMessage ?? null };
  const shown = state.payload;
  // A thread that closed mid-session turns read-only now; the reload that follows confirms it.
  const payload = shown && refusal?.code === "closed" ? { ...shown, thread: { ...shown.thread, canWrite: false } } : shown;
  return { ...state, sending: false, sendFailure, payload };
}

/** A send refused because the thread closed or vanished: what is on screen is out of date. */
const outdates = (error: unknown): boolean =>
  error instanceof ChatClientError && (error.code === "closed" || error.status === 404);

const visibleOf = (state: OwnedState): ChatThreadState => ({
  phase: state.phase,
  payload: state.payload,
  loadFailure: state.loadFailure,
  sending: state.sending,
  sendFailure: state.sendFailure,
});

type Update = (owner: ChatClient, step: (previous: OwnedState) => OwnedState) => void;

interface UseChatThreadOptions {
  client: ChatClient;
  refreshSignal?: unknown;
  /** Told the unread count each load found (before marking read), then what is left once marked read. */
  onUnreadChange?: (unread: number) => void;
  /** Mark the thread read after a load shows unread messages. Default true; see {@link ChatAutoMarkRead}. */
  autoMarkRead?: ChatAutoMarkRead;
}

/** What a load showed, and whether that load is still the latest. */
interface Shown {
  readonly payload: ChatThreadPayload;
  readonly isCurrent: () => boolean;
}

interface Loader {
  readonly load: () => Promise<void>;
  readonly onVisibleChange: (visible: boolean) => void;
}

/** The latest value, readable from callbacks without re-creating them. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/** Tell the host the unread count; its callback throwing must not reject a load nobody awaits. */
function report(onUnread: { readonly current?: (unread: number) => void }, unread: number): void {
  try {
    onUnread.current?.(unread);
  } catch {
    // The host's badge failed to update; the thread itself is fine.
  }
}

/** The state, owned by the client it was loaded through; `update` ignores a client the hook has left. */
function useOwnedState(client: ChatClient): { state: OwnedState; update: Update; latest: { readonly current: ChatClient } } {
  const [state, setState] = useState<OwnedState>(() => fresh(client));
  const latest = useLatest(client);
  const update = useCallback<Update>(
    (owner, step) => {
      setState((previous) => {
        if (owner !== latest.current) return previous;
        return step(previous.owner === owner ? previous : fresh(owner));
      });
    },
    [latest],
  );
  return { state, update, latest };
}

/**
 * Mark read what a load showed — at once, or (`"visible"`) once the list is on
 * screen. Only the latest load's unread wait; a newer load replaces them.
 */
function useMarkRead(options: UseChatThreadOptions, onUnread: { readonly current?: (unread: number) => void }) {
  const { client } = options;
  const mode = useLatest(options.autoMarkRead ?? true);
  const visible = useRef(false);
  const pending = useRef<Shown | null>(null);

  const markRead = useCallback(
    async ({ payload, isCurrent }: Shown) => {
      const upTo = payload.messages.at(-1)?.createdAt;
      if (payload.unread === 0 || upTo === undefined) return;
      const left = await client.markRead(upTo).catch(() => null);
      if (left !== null && isCurrent()) report(onUnread, left);
    },
    [client, onUnread],
  );

  const markShown = useCallback(
    async (shown: Shown) => {
      pending.current = null;
      if (mode.current === false || shown.payload.unread === 0) return;
      if (mode.current === "visible" && !visible.current) {
        pending.current = shown;
        return;
      }
      await markRead(shown);
    },
    [mode, markRead],
  );

  const onVisibleChange = useCallback(
    (now: boolean) => {
      visible.current = now;
      const waiting = pending.current;
      if (!now || waiting === null || mode.current !== "visible") return;
      pending.current = null;
      if (waiting.isCurrent()) void markRead(waiting);
    },
    [mode, markRead],
  );

  return { markShown, onVisibleChange };
}

/** Load on mount and on every signal; ignore a load something newer overtook; mark read what a load showed. */
function useLoader(options: UseChatThreadOptions, update: Update): Loader {
  const { client, refreshSignal } = options;
  const generation = useRef(0);
  const onUnread = useLatest(options.onUnreadChange);
  const { markShown, onVisibleChange } = useMarkRead(options, onUnread);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    const isCurrent = () => mine === generation.current;
    let payload: ChatThreadPayload;
    try {
      payload = await client.load();
    } catch (error) {
      if (isCurrent()) update(client, (previous) => afterLoadFailure(previous, error));
      return;
    }
    if (!isCurrent()) return;
    update(client, (previous) => afterLoad(previous, payload));
    report(onUnread, payload.unread);
    await markShown({ payload, isCurrent });
  }, [client, update, markShown, onUnread]);

  useEffect(() => {
    void load();
    // Whatever is still in flight belongs to a thread or a signal that has moved on.
    return () => {
      generation.current += 1;
    };
  }, [load, refreshSignal]);

  return { load, onVisibleChange };
}

export function useChatThread(options: UseChatThreadOptions): ChatThreadControls {
  const { client } = options;
  const { state, update, latest } = useOwnedState(client);
  const { load, onVisibleChange } = useLoader(options, update);

  const deliver = useCallback(
    async (input: ChatSendInput): Promise<boolean> => {
      update(client, (previous) => ({ ...previous, sending: true, sendFailure: null }));
      try {
        const message = await client.send(input);
        update(client, (previous) => ({
          ...previous,
          sending: false,
          payload: previous.payload ? { ...previous.payload, messages: mergeMessages(previous.payload.messages, [message]) } : null,
        }));
        return true;
      } catch (error) {
        update(client, (previous) => afterSendFailure(previous, error));
        if (outdates(error) && latest.current === client) void load();
        return false;
      }
    },
    [client, update, load, latest],
  );

  const send = useCallback((text: string) => deliver({ body: text }), [deliver]);
  const sendQuickReply = useCallback((key: string) => deliver({ quickReply: key }), [deliver]);
  const reload = useCallback(() => {
    update(client, (previous) => (previous.payload ? previous : { ...previous, phase: "loading", loadFailure: null }));
    void load();
  }, [client, update, load]);

  const visible = state.owner === client ? state : fresh(client);
  const seen = options.autoMarkRead === "visible" ? { onVisibleChange } : {};
  return { ...visibleOf(visible), send, sendQuickReply, reload, ...seen };
}
