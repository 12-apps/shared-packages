/**
 * The thread, drawn once for both renderers.
 *
 * Built only from `@12-apps/ui` primitives and only their cross-platform
 * (`*.base`) props, so the same tree renders on the web (MUI) and in a React
 * Native app (the package's `react-native` export condition resolves each
 * primitive to its native twin). The pieces that differ per platform arrive
 * as a {@link ChatPlatform}: the frame (keyboard avoidance on native), the
 * scrolling message list, and the composer, whose change events are not the
 * same shape.
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
import { Text } from "@12-apps/ui/typography/Text";
import { useState, type ComponentType, type JSX, type ReactNode } from "react";

import type { ChatThreadControls } from "../client/use-chat-thread";
import type { ChatUiCopy } from "../client/copy";
import type { ChatQuickReply, ChatWireMessage } from "../core/types";

/** What a platform's composer receives: a controlled field plus its send action. */
export interface ChatComposerProps {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly onSubmit: () => void;
  /** A message is in flight: the send action is gated, the FIELD stays usable. */
  readonly sending: boolean;
  readonly maxLength: number;
  readonly copy: ChatUiCopy;
}

/** What a platform's message list receives: the bubbles, and when to follow the newest. */
export interface ChatMessageListProps {
  readonly children: ReactNode;
  /** The list's accessible name. */
  readonly label: string;
  /** Changes whenever a message is added — the list scrolls to its end on each change. */
  readonly scrollKey: string;
  readonly testID: string;
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
  readonly Composer: ComponentType<ChatComposerProps>;
}

interface ChatThreadViewProps {
  readonly controls: ChatThreadControls;
  readonly copy: ChatUiCopy;
  readonly formatTime: (iso: string) => string;
  readonly platform: ChatPlatform;
  readonly keyboardOffset?: number;
  readonly testID?: string;
}

function Bubble({ message, formatTime }: { message: ChatWireMessage; formatTime: (iso: string) => string }): JSX.Element {
  return (
    <Box direction="row" justify={message.mine ? "end" : "start"} testID={`chat-message-${message.id}`}>
      <Box bg={message.mine ? "default" : "paper"} bordered radius="md" px={2} py={1} gap={0.5}>
        <Stack direction="row" gap={1} align="baseline">
          <Text variant="caption" weight="semibold" color={message.mine ? "primary" : "secondary"}>
            {message.label}
          </Text>
          <Text variant="caption" color="secondary">
            {formatTime(message.createdAt)}
          </Text>
        </Stack>
        <Text>{message.body}</Text>
      </Box>
    </Box>
  );
}

function QuickReplies(props: {
  replies: readonly ChatQuickReply[];
  disabled: boolean;
  copy: ChatUiCopy;
  onPick: (key: string) => void;
}): JSX.Element | null {
  if (props.replies.length === 0) return null;
  return (
    <Stack gap={1} testID="chat-quick-replies">
      <Text variant="caption" color="secondary">
        {props.copy.quickReplies}
      </Text>
      <Box direction="row" wrap gap={1}>
        {props.replies.map((reply) => (
          <Chip
            key={reply.key}
            label={reply.text}
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

function Writing(props: ChatThreadViewProps): JSX.Element {
  const { controls, copy, platform } = props;
  const { Composer } = platform;
  const [draft, setDraft] = useState("");
  const thread = controls.payload?.thread;
  if (!thread) return <></>;
  if (!thread.canWrite) {
    return <Alert variant="info" description={copy.closed} testID="chat-closed" />;
  }
  const submit = async (): Promise<void> => {
    if (draft.trim() === "" || controls.sending) return;
    const sent = draft;
    // Only what was sent is cleared: the field stays live during the send.
    if (await controls.send(sent)) setDraft((current) => (current === sent ? "" : current));
  };
  return (
    <Stack gap={2}>
      {controls.sendFailure ? (
        <Alert variant="danger" description={controls.sendFailure.message ?? copy.sendFailed} testID="chat-send-failed" />
      ) : null}
      <QuickReplies
        replies={thread.quickReplies}
        disabled={controls.sending}
        copy={copy}
        onPick={(key) => void controls.sendQuickReply(key)}
      />
      {thread.freeText ? (
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={() => void submit()}
          sending={controls.sending}
          maxLength={thread.maxLength}
          copy={copy}
        />
      ) : null}
    </Stack>
  );
}

function Messages(props: ChatThreadViewProps & { messages: readonly ChatWireMessage[] }): JSX.Element {
  const { copy, formatTime, messages } = props;
  const { MessageList } = props.platform;
  const newest = messages.at(-1);
  return (
    <MessageList label={copy.messagesLabel} scrollKey={`${messages.length}:${newest?.id ?? ""}`} testID="chat-messages">
      {messages.length === 0 ? (
        <EmptyState variant="minimal" title={copy.emptyTitle} description={copy.emptyDescription} testID="chat-empty" />
      ) : (
        messages.map((message) => <Bubble key={message.id} message={message} formatTime={formatTime} />)
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
  return (
    <Frame testID={props.testID ?? "chat-thread"} keyboardOffset={props.keyboardOffset}>
      <Messages {...props} messages={controls.payload.messages} />
      <Writing {...props} />
    </Frame>
  );
}
