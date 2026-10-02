/**
 * The thread, drawn once for both renderers.
 *
 * Built only from `@12-apps/ui` primitives and only their cross-platform
 * (`*.base`) props, so the same tree renders on the web (MUI) and in a React
 * Native app (the package's `react-native` export condition resolves each
 * primitive to its native twin). The one piece that differs per platform —
 * the text field and its send button, whose change events are not the same
 * shape — arrives as `Composer`.
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
import { useState, type ComponentType, type JSX } from "react";

import type { ChatThreadControls } from "../client/use-chat-thread";
import type { ChatUiCopy } from "../client/copy";
import type { ChatQuickReply, ChatWireMessage } from "../core/types";

/** What a platform's composer receives: a controlled field plus its send action. */
export interface ChatComposerProps {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly onSubmit: () => void;
  readonly sending: boolean;
  readonly maxLength: number;
  readonly copy: ChatUiCopy;
}

interface ChatThreadViewProps {
  readonly controls: ChatThreadControls;
  readonly copy: ChatUiCopy;
  readonly formatTime: (iso: string) => string;
  readonly Composer: ComponentType<ChatComposerProps>;
  readonly testID?: string;
}

function Bubble({ message, formatTime }: { message: ChatWireMessage; formatTime: (iso: string) => string }): JSX.Element {
  return (
    <Box direction="row" justify={message.mine ? "end" : "start"} testID={`chat-message-${message.id}`}>
      <Box bg="paper" bordered radius="md" px={2} py={1} gap={0.5}>
        <Stack direction="row" gap={1} align="baseline">
          <Text variant="caption" weight="semibold" color={message.mine ? "primary" : "neutral"}>
            {message.label}
          </Text>
          <Text variant="caption" color="neutral">
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
      <Text variant="caption" color="neutral">
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
  const { controls, copy, Composer } = props;
  const [draft, setDraft] = useState("");
  const thread = controls.payload?.thread;
  if (!thread) return <></>;
  if (!thread.canWrite) {
    return <Alert variant="info" description={copy.closed} testID="chat-closed" />;
  }
  const submit = async (): Promise<void> => {
    if (draft.trim() === "" || controls.sending) return;
    if (await controls.send(draft)) setDraft("");
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

export function ChatThreadView(props: ChatThreadViewProps): JSX.Element {
  const { controls, copy, formatTime } = props;
  if (controls.phase === "loading") {
    return <LoadingState message={copy.loading} testID="chat-loading" />;
  }
  if (controls.phase === "error" || !controls.payload) {
    return <ErrorState message={copy.loadError} onRetry={controls.reload} retryLabel={copy.retry} testID="chat-error" />;
  }
  const { messages } = controls.payload;
  return (
    <Stack gap={2} testID={props.testID ?? "chat-thread"}>
      {messages.length === 0 ? (
        <EmptyState variant="minimal" title={copy.emptyTitle} description={copy.emptyDescription} testID="chat-empty" />
      ) : (
        <Stack gap={1} testID="chat-messages">
          {messages.map((message) => (
            <Bubble key={message.id} message={message} formatTime={formatTime} />
          ))}
        </Stack>
      )}
      <Writing {...props} />
    </Stack>
  );
}
