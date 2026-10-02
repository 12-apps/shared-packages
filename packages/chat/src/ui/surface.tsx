/**
 * The surface factory both renderers share: config in, `{ ChatThread }` out.
 * Each platform entry passes its own composer; everything else is common.
 */

import { useMemo, type ComponentType, type JSX } from "react";

import { createChatClient, type ChatFetch } from "../client/api";
import { missingUiCopy } from "../client/assert";
import type { ChatUiCopy } from "../client/copy";
import { useChatThread } from "../client/use-chat-thread";
import { ChatConfigError } from "../core/errors";
import { ChatThreadView, type ChatComposerProps } from "./thread-view";

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
  /** The unread count each load found, then 0 once marked read. */
  readonly onUnreadChange?: (unread: number) => void;
  readonly testID?: string;
}

export interface ChatSurface {
  ChatThread: (props: ChatThreadProps) => JSX.Element;
}

export function buildChatSurface(config: ChatSurfaceConfig, Composer: ComponentType<ChatComposerProps>): ChatSurface {
  if (typeof config?.fetch !== "function") throw new ChatConfigError("fetch is required — the host's credentialed client.");
  if (typeof config.formatTime !== "function") throw new ChatConfigError("formatTime is required — time formatting is the host's.");
  const missing = missingUiCopy(config.copy);
  if (missing.length > 0) {
    throw new ChatConfigError(`copy is required, with every key non-blank — missing: ${missing.join(", ")}.`);
  }
  const { fetch, copy, formatTime } = config;

  function ChatThread(props: ChatThreadProps): JSX.Element {
    const client = useMemo(() => createChatClient({ fetch, endpoint: props.endpoint }), [props.endpoint]);
    const controls = useChatThread({ client, refreshSignal: props.refreshSignal, onUnreadChange: props.onUnreadChange });
    return <ChatThreadView controls={controls} copy={copy} formatTime={formatTime} Composer={Composer} testID={props.testID} />;
  }

  return { ChatThread };
}
