/**
 * The surface factory both renderers share: config in, `{ ChatThread }` out.
 * Each platform entry passes its own frame, message list and composer;
 * everything else is common.
 */

import { useMemo, type JSX } from "react";

import { createChatClient, type ChatFetch } from "../client/api";
import { missingUiCopy } from "../client/assert";
import type { ChatUiCopy } from "../client/copy";
import { useChatThread, type ChatAutoMarkRead } from "../client/use-chat-thread";
import { ChatConfigError } from "../core/errors";
import { ChatThreadView, type ChatPlatform } from "./thread-view";

/** What a host supplies once. All REQUIRED. */
export interface ChatSurfaceConfig {
  /** The host's credentialed fetch (cookie session, Bearer link, …). */
  readonly fetch: ChatFetch;
  /** Every rendered string. */
  readonly copy: ChatUiCopy;
  /** How a message's time reads — the host's locale and clock conventions. */
  readonly formatTime: (iso: string) => string;
}

export interface ChatThreadProps {
  /** Where this thread's three routes are mounted. */
  readonly endpoint: string;
  /** Change it to reload — the host's live channel says the thread moved. */
  readonly refreshSignal?: unknown;
  /** The unread count each load found, then what is left (0) once marked read. */
  readonly onUnreadChange?: (unread: number) => void;
  /**
   * Mark the thread read once a load shows unread messages. Default true.
   * A host that mounts the thread hidden only to drive a badge passes false,
   * so nothing is marked read that nobody saw. `"visible"` waits until the
   * message list is on screen: for a thread mounted below the fold (a drawer's
   * lower half), so mounting it is not reading it. On the web that is an
   * IntersectionObserver on the list; on native the list is on screen once
   * it is mounted.
   */
  readonly autoMarkRead?: ChatAutoMarkRead;
  /**
   * Native only: the distance from the window top to the thread (a navigator
   * header), in dp, so the composer clears the keyboard exactly. Default 0.
   */
  readonly keyboardOffset?: number;
  readonly testID?: string;
}

export interface ChatSurface {
  ChatThread: (props: ChatThreadProps) => JSX.Element;
}

export function buildChatSurface(config: ChatSurfaceConfig, platform: ChatPlatform): ChatSurface {
  if (typeof config?.fetch !== "function") throw new ChatConfigError("fetch is required — the host's credentialed client.");
  if (typeof config.formatTime !== "function") throw new ChatConfigError("formatTime is required — time formatting is the host's.");
  const missing = missingUiCopy(config.copy);
  if (missing.length > 0) {
    throw new ChatConfigError(`copy is required, with every key non-blank — missing: ${missing.join(", ")}.`);
  }
  const { fetch, copy, formatTime } = config;

  function ChatThread(props: ChatThreadProps): JSX.Element {
    const client = useMemo(() => createChatClient({ fetch, endpoint: props.endpoint }), [props.endpoint]);
    const controls = useChatThread({
      client,
      refreshSignal: props.refreshSignal,
      onUnreadChange: props.onUnreadChange,
      autoMarkRead: props.autoMarkRead,
    });
    // Keyed by endpoint: another thread starts with an empty draft, not this one's.
    return (
      <ChatThreadView
        key={props.endpoint}
        controls={controls}
        copy={copy}
        formatTime={formatTime}
        platform={platform}
        keyboardOffset={props.keyboardOffset}
        testID={props.testID}
      />
    );
  }

  return { ChatThread };
}
