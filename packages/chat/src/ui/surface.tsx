/**
 * The surface factory both renderers share: config in, `{ ChatThread }` out.
 * Each platform entry passes its own frame, message list and composer;
 * everything else is common.
 */

import { useMemo, type JSX } from "react";

import { createChatClient, type ChatFetch } from "../client/api";
import { missingUiCopy } from "../client/assert";
import type { ChatUiCopy } from "../client/copy";
import { useChatThread, type ChatAutoMarkRead, type ChatSendFailure } from "../client/use-chat-thread";
import { ChatConfigError } from "../core/errors";
import { ChatThreadView, DEFAULT_CHAT_VIEW_OPTIONS, type ChatPlatform, type ChatViewOptions } from "./thread-view";

/** What a host supplies once. The first three are REQUIRED; the rest change how the thread draws. */
export interface ChatSurfaceConfig {
  /** The host's credentialed fetch (cookie session, Bearer link, …). */
  readonly fetch: ChatFetch;
  /** Every rendered string. */
  readonly copy: ChatUiCopy;
  /** How a message's time reads — the host's locale and clock conventions. */
  readonly formatTime: (iso: string) => string;
  /**
   * A quick reply's chip label, from the server's reply `key` and its full
   * sentence `text`: for a host whose chips are shorter names for the replies.
   * A tap still sends the KEY, so the thread stores the full sentence. Return
   * the `text` (or a blank) for a key you do not know. Default: the sentence.
   */
  readonly quickReplyLabel?: (key: string, text: string) => string;
  /**
   * `"visible"` (default) draws `copy.quickReplies` over the chips; `"label"`
   * keeps it only as the row's accessible name.
   */
  readonly quickRepliesHeading?: "visible" | "label";
  /**
   * `"always"` (default) shows `copy.emptyDescription` under an empty thread's
   * title; `"withQuickReplies"` only while quick replies are drawn below it,
   * for a description that points at them.
   */
  readonly emptyDescription?: "always" | "withQuickReplies";
  /**
   * The line a failed send shows. Return null for the default: the server's
   * own sentence, else `copy.sendFailed`. The failure's `code` is the
   * package's (`contact_info`, `rate_limited`, …), `message` the server's.
   */
  readonly sendFailureMessage?: (failure: ChatSendFailure) => string | null;
  /**
   * `"alert"` (default): a full alert over the quick replies, until the next
   * send. `"compact"`: an icon and at most two lines right on the composer,
   * gone as soon as the draft is edited; a refused message (`contact_info`)
   * reads as a warning, any other failure as an error.
   */
  readonly sendFailureNotice?: "alert" | "compact";
  /**
   * `"disabled"` (default) greys the send button while the field is blank;
   * `"inert"` keeps it drawn enabled, and a blank send does nothing.
   */
  readonly sendWhenEmpty?: "disabled" | "inert";
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
  /**
   * Leave the quick replies out — for a host short of room (a small phone
   * with the keyboard up). Change it freely: the draft and the list stay.
   */
  readonly foldQuickReplies?: boolean;
  /**
   * Native only: called with the send-failure notice's height in dp each time
   * it is laid out, and with 0 whenever none is drawn (dismissed, the thread
   * turned read-only, the thread unmounted) — so a host sizing the room around
   * the thread can count it. It does not include the gap over it.
   */
  readonly onNoticeHeight?: (height: number) => void;
  /**
   * The composer's field took (`true`) or lost (`false`) the focus; `false`
   * also when the field goes away while focused.
   */
  readonly onComposerFocusChange?: (focused: boolean) => void;
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
  const options = viewOptionsOf(config);

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
        options={options}
        keyboardOffset={props.keyboardOffset}
        foldQuickReplies={props.foldQuickReplies}
        onNoticeHeight={props.onNoticeHeight}
        onComposerFocusChange={props.onComposerFocusChange}
        testID={props.testID}
      />
    );
  }

  return { ChatThread };
}

/** One of `allowed`, or the default when absent; anything else is a config mistake, said at build time. */
function oneOf<T extends string>(name: string, value: T | undefined, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) throw new ChatConfigError(`${name} must be one of ${allowed.join(", ")}.`);
  return value;
}

function optionalFunction<T>(name: string, value: T | undefined): T | undefined {
  if (value !== undefined && typeof value !== "function") throw new ChatConfigError(`${name} must be a function when given.`);
  return value;
}

function viewOptionsOf(config: ChatSurfaceConfig): ChatViewOptions {
  const defaults = DEFAULT_CHAT_VIEW_OPTIONS;
  return {
    quickReplyLabel: optionalFunction("quickReplyLabel", config.quickReplyLabel),
    sendFailureMessage: optionalFunction("sendFailureMessage", config.sendFailureMessage),
    quickRepliesHeading: oneOf("quickRepliesHeading", config.quickRepliesHeading, ["visible", "label"], defaults.quickRepliesHeading),
    emptyDescription: oneOf("emptyDescription", config.emptyDescription, ["always", "withQuickReplies"], defaults.emptyDescription),
    sendFailureNotice: oneOf("sendFailureNotice", config.sendFailureNotice, ["alert", "compact"], defaults.sendFailureNotice),
    sendWhenEmpty: oneOf("sendWhenEmpty", config.sendWhenEmpty, ["disabled", "inert"], defaults.sendWhenEmpty),
  };
}
