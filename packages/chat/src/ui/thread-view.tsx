/**
 * The thread, drawn once for both renderers.
 *
 * Built only from `@12-apps/ui` primitives and only their cross-platform
 * (`*.base`) props, so the same tree renders on the web (MUI) and in a React
 * Native app (the package's `react-native` export condition resolves each
 * primitive to its native twin). The pieces that differ per platform arrive
 * as a {@link ChatPlatform}: the frame (keyboard avoidance on native), the
 * scrolling message list, a message's bubble (its surface is styled beyond the
 * shared props), and the composer, whose change events are not the same shape.
 *
 * Every word on screen is host copy or server data: role labels come from the
 * server (the host's role config), the rest from {@link ChatUiCopy}.
 */

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Chip } from "@12-apps/ui/data-display/Chip";
import { EmptyState } from "@12-apps/ui/data-display/EmptyState";
import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import { Box } from "@12-apps/ui/layout/Box";
import { Stack } from "@12-apps/ui/layout/Stack";
import { Icon } from "@12-apps/ui/icons";
import { Text } from "@12-apps/ui/typography/Text";
import { useEffect, useRef, useState, type ComponentType, type JSX, type ReactNode } from "react";

import type { ChatSendFailure, ChatThreadControls } from "../client/use-chat-thread";
import type { ChatUiCopy } from "../client/copy";
import type { ChatQuickReply, ChatWireMessage, ChatWireThread } from "../core/types";

/** What a platform's composer receives: a controlled field plus its send action. */
export interface ChatComposerProps {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly onSubmit: () => void;
  /** A message is in flight: the send action is gated, the FIELD stays usable. */
  readonly sending: boolean;
  readonly maxLength: number;
  readonly copy: ChatUiCopy;
  /**
   * `true` (the default look): the send button is disabled while the field is
   * blank. `false`: it stays drawn as enabled and a tap on a blank field does
   * nothing (the thread's submit ignores it) — {@link ChatViewOptions.sendWhenEmpty}.
   */
  readonly disableSendWhenEmpty: boolean;
  /** The field took or lost the focus — and `false` if it goes away focused. */
  readonly onFocusChange?: (focused: boolean) => void;
}

/** One quick reply as drawn: the key a tap sends, and the label the host chose for it. */
export interface ChatQuickReplyItem {
  readonly key: string;
  readonly label: string;
}

/** What a platform's quick-reply row receives. Never rendered with an empty `replies`. */
export interface ChatQuickRepliesProps {
  readonly replies: readonly ChatQuickReplyItem[];
  readonly disabled: boolean;
  /** The row's heading (`copy.quickReplies`): drawn over it, or only its accessible name. */
  readonly heading: string;
  readonly headingVisible: boolean;
  readonly onPick: (key: string) => void;
}

/** What a platform's send-failure notice receives. */
export interface ChatNoticeProps {
  readonly text: string;
  /** `warning` for a refused message (the contact filter), `danger` for anything else. */
  readonly tone: "warning" | "danger";
  /** A one- or two-line notice on the composer, rather than a full alert over the quick replies. */
  readonly compact: boolean;
  /** Native: the notice's height as drawn, in dp, on every layout. */
  readonly onHeight?: (height: number) => void;
  readonly testID: string;
}

/** What a platform's message list receives: the bubbles, and when to follow the newest. */
export interface ChatMessageListProps {
  readonly children: ReactNode;
  /** The list's accessible name. */
  readonly label: string;
  /** Changes whenever a message is added — the list scrolls to its end on each change. */
  readonly scrollKey: string;
  readonly testID: string;
  /**
   * Set only when the thread marks itself read once SEEN (`autoMarkRead="visible"`):
   * the list reports whether it is on screen now, and `false` when it unmounts.
   */
  readonly onVisibleChange?: (visible: boolean) => void;
}

/** What a platform's bubble receives: whose message it is, and its label, time and text. */
export interface ChatBubbleProps {
  /** The reader's own message: drawn on a tint of the theme's primary colour, others on paper. */
  readonly mine: boolean;
  readonly children: ReactNode;
}

/** What a platform's frame receives: the list above, the writing area pinned below. */
export interface ChatFrameProps {
  readonly children: ReactNode;
  readonly testID: string;
  /** Native only: the distance from the window top to the thread (a navigator header), in dp. */
  readonly keyboardOffset?: number;
}

/** The per-platform pieces of the thread. */
export interface ChatPlatform {
  readonly Frame: ComponentType<ChatFrameProps>;
  readonly MessageList: ComponentType<ChatMessageListProps>;
  readonly Bubble: ComponentType<ChatBubbleProps>;
  readonly Composer: ComponentType<ChatComposerProps>;
  readonly QuickReplies: ComponentType<ChatQuickRepliesProps>;
  readonly Notice: ComponentType<ChatNoticeProps>;
}

/**
 * How the thread draws the parts a host may want differently — every one
 * optional on the surface config, resolved to these defaults by the surface.
 */
export interface ChatViewOptions {
  /** A quick reply's chip label from its key and the server's sentence; the sentence by default. */
  readonly quickReplyLabel?: (key: string, text: string) => string;
  /** `visible` draws `copy.quickReplies` over the chips; `label` keeps it only as their accessible name. */
  readonly quickRepliesHeading: "visible" | "label";
  /** `withQuickReplies` shows `copy.emptyDescription` only while quick replies are drawn under the list. */
  readonly emptyDescription: "always" | "withQuickReplies";
  /** The line a failed send shows; return null for the default (the server's sentence, else `copy.sendFailed`). */
  readonly sendFailureMessage?: (failure: ChatSendFailure) => string | null;
  /** `alert` over the quick replies until the next send; `compact` on the composer, cleared once the draft is edited. */
  readonly sendFailureNotice: "alert" | "compact";
  /** `disabled` greys the send button on a blank field; `inert` keeps it drawn enabled, and a blank send does nothing. */
  readonly sendWhenEmpty: "disabled" | "inert";
}

export const DEFAULT_CHAT_VIEW_OPTIONS: ChatViewOptions = {
  quickRepliesHeading: "visible",
  emptyDescription: "always",
  sendFailureNotice: "alert",
  sendWhenEmpty: "disabled",
};

interface ChatThreadViewProps {
  readonly controls: ChatThreadControls;
  readonly copy: ChatUiCopy;
  readonly formatTime: (iso: string) => string;
  readonly platform: ChatPlatform;
  readonly options: ChatViewOptions;
  readonly keyboardOffset?: number;
  /** Leave the quick replies out (the host has no room for them now). */
  readonly foldQuickReplies?: boolean;
  /** The send-failure notice's drawn height (native), and 0 whenever none is drawn. */
  readonly onNoticeHeight?: (height: number) => void;
  /** The composer's field took or lost the focus. */
  readonly onComposerFocusChange?: (focused: boolean) => void;
  readonly testID?: string;
}

function Message(props: {
  message: ChatWireMessage;
  formatTime: (iso: string) => string;
  Bubble: ChatPlatform["Bubble"];
}): JSX.Element {
  const { message, formatTime, Bubble } = props;
  return (
    <Box direction="row" justify={message.mine ? "end" : "start"} testID={`chat-message-${message.id}`}>
      <Bubble mine={message.mine}>
        {/* Who wrote it over the text, when under it: a bubble reads top to bottom. */}
        {/* Body-text colour on the own tint: the primary colour on its own tint falls under 4.5:1. */}
        <Text variant="caption" weight="semibold" color={message.mine ? "neutral" : "secondary"}>
          {message.label}
        </Text>
        <Text>{message.body}</Text>
        <Text variant="caption" color="secondary">
          {formatTime(message.createdAt)}
        </Text>
      </Bubble>
    </Box>
  );
}

/**
 * The web's quick-reply row, and native's default (`chip`, wrapping, heading
 * shown): ui's outlined chips, wrapping. A hidden heading stays the row's
 * accessible name (`aria-label`; native routes that case to its own row).
 */
export function ChipQuickReplies(props: ChatQuickRepliesProps): JSX.Element {
  const named = props.headingVisible ? {} : { "aria-label": props.heading };
  return (
    <Stack gap={1} testID="chat-quick-replies" {...named}>
      {props.headingVisible ? (
        <Text variant="caption" color="secondary">
          {props.heading}
        </Text>
      ) : null}
      <Box direction="row" wrap gap={1}>
        {props.replies.map((reply) => (
          <Chip
            key={reply.key}
            label={reply.label}
            icon={<Icon name="Bolt" size={14} />}
            variant="outlined"
            disabled={props.disabled}
            onClick={() => props.onPick(reply.key)}
            testID={`chat-quick-${reply.key}`}
          />
        ))}
      </Box>
    </Stack>
  );
}

/** A quick reply's label: the host's, unless it has none (or a blank one) for this key. */
function labelOf(options: ChatViewOptions, reply: ChatQuickReply): string {
  const label = options.quickReplyLabel?.(reply.key, reply.text);
  return typeof label === "string" && label.trim() !== "" ? label : reply.text;
}

/** The line a failed send shows, and its tone. */
function noticeOf(options: ChatViewOptions, copy: ChatUiCopy, failure: ChatSendFailure): Pick<ChatNoticeProps, "text" | "tone"> {
  const own = options.sendFailureMessage?.(failure);
  const text = typeof own === "string" && own.trim() !== "" ? own : (failure.message ?? copy.sendFailed);
  // A refusal is the sender's to fix, not a fault: on the compact line it reads as a warning.
  const tone = options.sendFailureNotice === "compact" && failure.code === "contact_info" ? "warning" : "danger";
  return { text, tone };
}

/** Tell the host 0 whenever no notice is drawn, and when the writing area goes away. */
function useNoticeHeight(drawn: boolean, onNoticeHeight?: (height: number) => void): ((height: number) => void) | undefined {
  const latest = useRef(onNoticeHeight);
  useEffect(() => {
    latest.current = onNoticeHeight;
  }, [onNoticeHeight]);
  useEffect(() => {
    if (!drawn) latest.current?.(0);
  }, [drawn]);
  useEffect(() => () => latest.current?.(0), []);
  // Measured only for a host that asked: the default path draws the notice exactly as before.
  return onNoticeHeight ? (height) => latest.current?.(height) : undefined;
}

/**
 * The failure on screen. In the compact look an edit made while one shows
 * dismisses it (`onEdit`); a later failure is a new one, and shows again.
 */
function useShownFailure(
  failure: ChatSendFailure | null,
  compact: boolean,
): { shown: ChatSendFailure | null; onEdit?: () => void } {
  const [dismissed, setDismissed] = useState<ChatSendFailure | null>(null);
  const shown = failure !== null && failure !== dismissed ? failure : null;
  return { shown, onEdit: compact && shown ? () => setDismissed(shown) : undefined };
}

/** The chips under the list, unless the host folded them or the role has none. */
function ReplyRow(props: ChatThreadViewProps & { thread: ChatWireThread }): JSX.Element | null {
  const { controls, copy, options, thread } = props;
  const { QuickReplies } = props.platform;
  if (props.foldQuickReplies || thread.quickReplies.length === 0) return null;
  return (
    <QuickReplies
      replies={thread.quickReplies.map((reply) => ({ key: reply.key, label: labelOf(options, reply) }))}
      disabled={controls.sending}
      heading={copy.quickReplies}
      headingVisible={options.quickRepliesHeading === "visible"}
      onPick={(key) => void controls.sendQuickReply(key)}
    />
  );
}

/**
 * The field and its send action. In the compact look it is wrapped with the
 * notice slot right over it — always, so the field is never remounted (and
 * the keyboard never dropped) when a notice comes or goes; in the default
 * look it is the writing area's own child, as it always was.
 */
function ComposerBlock(
  props: ChatThreadViewProps & { thread: ChatWireThread; compact: boolean; notice: ReactNode; onEdit?: () => void },
): JSX.Element | null {
  const { controls, copy, options, thread } = props;
  const { Composer } = props.platform;
  const [draft, setDraft] = useState("");
  const submit = async (): Promise<void> => {
    if (draft.trim() === "" || controls.sending) return;
    const sent = draft;
    // Only what was sent is cleared: the field stays live during the send.
    if (await controls.send(sent)) setDraft((current) => (current === sent ? "" : current));
  };
  const composer = thread.freeText ? (
    <Composer
      value={draft}
      onChange={(text) => {
        props.onEdit?.();
        setDraft(text);
      }}
      onSubmit={() => void submit()}
      sending={controls.sending}
      maxLength={thread.maxLength}
      copy={copy}
      disableSendWhenEmpty={options.sendWhenEmpty === "disabled"}
      onFocusChange={props.onComposerFocusChange}
    />
  ) : null;
  if (!props.compact) return composer;
  if (props.notice === null && composer === null) return null;
  return (
    <Stack gap={0.5}>
      {props.notice}
      {composer}
    </Stack>
  );
}

function Writing(props: ChatThreadViewProps): JSX.Element {
  const { controls, copy, options } = props;
  const { Notice } = props.platform;
  const compact = options.sendFailureNotice === "compact";
  const failure = useShownFailure(controls.sendFailure, compact);
  const thread = controls.payload?.thread;
  const onHeight = useNoticeHeight(thread?.canWrite === true && failure.shown !== null, props.onNoticeHeight);
  if (!thread) return <></>;
  if (!thread.canWrite) {
    return <Alert variant="info" description={copy.closed} testID="chat-closed" />;
  }
  const notice = failure.shown ? (
    <Notice {...noticeOf(options, copy, failure.shown)} compact={compact} onHeight={onHeight} testID="chat-send-failed" />
  ) : null;
  // The compact notice sits right on the composer, and goes once the draft is edited.
  return (
    <Stack gap={2}>
      {compact ? null : notice}
      <ReplyRow {...props} thread={thread} />
      <ComposerBlock
        {...props}
        thread={thread}
        compact={compact}
        notice={compact ? notice : null}
        onEdit={failure.onEdit}
      />
    </Stack>
  );
}

function Messages(props: ChatThreadViewProps & { messages: readonly ChatWireMessage[] }): JSX.Element {
  const { copy, formatTime, messages, options } = props;
  const { MessageList, Bubble } = props.platform;
  const newest = messages.at(-1);
  const thread = props.controls.payload?.thread;
  // "Tap a quick reply below" only while there is one below to tap.
  const repliesBelow = thread?.canWrite === true && !props.foldQuickReplies && thread.quickReplies.length > 0;
  const description = options.emptyDescription === "always" || repliesBelow ? copy.emptyDescription : undefined;
  return (
    <MessageList
      label={copy.messagesLabel}
      scrollKey={`${messages.length}:${newest?.id ?? ""}`}
      testID="chat-messages"
      onVisibleChange={props.controls.onVisibleChange}
    >
      {messages.length === 0 ? (
        <EmptyState variant="minimal" title={copy.emptyTitle} description={description} testID="chat-empty" />
      ) : (
        messages.map((message) => <Message key={message.id} message={message} formatTime={formatTime} Bubble={Bubble} />)
      )}
    </MessageList>
  );
}

export function ChatThreadView(props: ChatThreadViewProps): JSX.Element {
  const { controls, copy } = props;
  const { Frame } = props.platform;
  if (controls.phase === "loading") {
    return <LoadingState message={copy.loading} testID="chat-loading" />;
  }
  if (controls.phase === "error" || !controls.payload) {
    return (
      <ErrorState
        message={controls.loadFailure ?? copy.loadError}
        onRetry={controls.reload}
        retryLabel={copy.retry}
        testID="chat-error"
      />
    );
  }
  const { thread, messages } = controls.payload;
  // A closed thread nobody wrote in has nothing to show and nothing to invite: only the notice.
  const nothingToShow = !thread.canWrite && messages.length === 0;
  return (
    <Frame testID={props.testID ?? "chat-thread"} keyboardOffset={props.keyboardOffset}>
      {nothingToShow ? null : <Messages {...props} messages={messages} />}
      <Writing {...props} />
    </Frame>
  );
}
