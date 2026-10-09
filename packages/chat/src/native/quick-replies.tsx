/**
 * The React Native quick-reply row, in one of two looks:
 *  - `chip` (the default): ui's outlined chips with a bolt, as on the web;
 *  - `pill`: a neutral filled pill with a bold label, at least
 *    {@link NATIVE_CHAT_METRICS.quickReplyMinHeight} dp tall — a thumb's
 *    touch target on the road. Drawn here rather than with ui's `Chip`, whose
 *    pill is 32 tall and whose filled neutral label is regular weight.
 *
 * The chips wrap, {@link NATIVE_CHAT_METRICS.quickReplyGap} dp apart. Below
 * `scrollBelowWidth` (the window's width, in dp) they sit on ONE line that
 * scrolls sideways instead, so a narrow phone does not give the messages'
 * height to four rows of chips.
 */

import { Chip } from "@12-apps/ui/data-display/Chip";
import { Icon } from "@12-apps/ui/icons";
import { useUiTheme } from "@12-apps/ui/provider";
import { Text } from "@12-apps/ui/typography/Text";
import type { ComponentType, JSX, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type TextProps } from "react-native";

import type { ChatQuickRepliesProps } from "../ui/thread-view";

/** The quick-reply row's numbers, for a host that sizes the room around the thread. */
export const NATIVE_CHAT_METRICS = {
  /** A `pill` quick reply's least height, in dp. */
  quickReplyMinHeight: 40,
  /** Between two quick replies, across and down, in dp. */
  quickReplyGap: 8,
} as const;

export type NativeQuickReplyLook = "chip" | "pill";

const { quickReplyMinHeight, quickReplyGap } = NATIVE_CHAT_METRICS;

const styles = StyleSheet.create({
  block: { gap: quickReplyGap },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: quickReplyGap },
  line: { flexDirection: "row", gap: quickReplyGap },
  pill: {
    minHeight: quickReplyMinHeight,
    paddingHorizontal: 14,
    borderRadius: quickReplyMinHeight / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
});

const ONE_LINE: Pick<TextProps, "numberOfLines"> = { numberOfLines: 1 };

function Pill(props: { label: string; disabled: boolean; onPress: () => void; testID: string }): JSX.Element {
  const { palette } = useUiTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: pressed ? palette.action.hover : palette.action.selected, borderColor: palette.divider },
        props.disabled ? styles.disabled : null,
      ]}
      testID={props.testID}
    >
      <Text variant="body" size="sm" weight="bold" {...ONE_LINE}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function Line(props: { oneLine: boolean; children: ReactNode }): JSX.Element {
  if (!props.oneLine) {
    return (
      <View style={styles.wrap} testID="chat-quick-row">
        {props.children}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.line}
      testID="chat-quick-row"
    >
      {props.children}
    </ScrollView>
  );
}

/** The row for one surface's look and narrow-phone width, built once per `createNativeChat`. */
export function nativeQuickReplies(look: NativeQuickReplyLook, scrollBelowWidth?: number): ComponentType<ChatQuickRepliesProps> {
  return function NativeQuickReplies(props: ChatQuickRepliesProps): JSX.Element {
    const { width } = useWindowDimensions();
    const oneLine = scrollBelowWidth !== undefined && width < scrollBelowWidth;
    return (
      <View
        style={styles.block}
        accessibilityLabel={props.headingVisible ? undefined : props.heading}
        testID="chat-quick-replies"
      >
        {props.headingVisible ? (
          <Text variant="caption" color="secondary">
            {props.heading}
          </Text>
        ) : null}
        <Line oneLine={oneLine}>
          {props.replies.map((reply) =>
            look === "pill" ? (
              <Pill
                key={reply.key}
                label={reply.label}
                disabled={props.disabled}
                onPress={() => props.onPick(reply.key)}
                testID={`chat-quick-${reply.key}`}
              />
            ) : (
              <Chip
                key={reply.key}
                label={reply.label}
                icon={<Icon name="Bolt" size={14} />}
                variant="outlined"
                disabled={props.disabled}
                onClick={() => props.onPick(reply.key)}
                testID={`chat-quick-${reply.key}`}
              />
            ),
          )}
        </Line>
      </View>
    );
  };
}
