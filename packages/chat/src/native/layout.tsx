/**
 * The React Native thread's frame, message list and bubble.
 *
 * The frame is the design system's `Screen` with its own scrolling off and no
 * safe-area edges (the host's screen owns those): it fills its parent and
 * lifts above the soft keyboard, so the composer pinned under the list is
 * never covered. The list is a `ScrollView` that follows the newest message
 * whenever its content grows or its viewport shrinks (the keyboard opening),
 * and lets a tap on the send button land while the keyboard is up. It is a
 * polite live region, so TalkBack reads a message as it arrives; and it is on
 * screen whenever it is mounted, so it reports itself visible on mount for a
 * thread that marks read only once seen.
 *
 * Mount the thread in a bounded parent (a `Screen` with `scroll={false}`, a
 * flex-1 view) — inside another ScrollView it has no height to fill. Pass
 * `keyboardOffset` when a navigator header sits above it.
 */

import { Box } from "@12-apps/ui/layout/Box";
import { Screen } from "@12-apps/ui/layout/Screen";
import { Stack } from "@12-apps/ui/layout/Stack";
import { useUiTheme } from "@12-apps/ui/provider";
import { useEffect, useRef, type JSX } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { ownBubbleTint } from "../ui/bubble-tint";
import type { ChatBubbleProps, ChatFrameProps, ChatMessageListProps } from "../ui/thread-view";

const NO_EDGES = [] as const;
const styles = StyleSheet.create({ fill: { flex: 1 } });
/** A bubble's widest, as a share of the thread. */
const BUBBLE_MAX_WIDTH = "80%" as const;

export function NativeFrame(props: ChatFrameProps): JSX.Element {
  return (
    <Screen
      scroll={false}
      safeAreaEdges={NO_EDGES}
      keyboardAvoiding
      keyboardVerticalOffset={props.keyboardOffset ?? 0}
      bg="transparent"
      gap={2}
      testID={props.testID}
    >
      {props.children}
    </Screen>
  );
}

/** On screen while mounted: report it once, and `false` when the list goes away. */
function useMountedVisibility(onVisibleChange?: (visible: boolean) => void): void {
  const latest = useRef(onVisibleChange);
  useEffect(() => {
    latest.current = onVisibleChange;
  }, [onVisibleChange]);
  const wanted = onVisibleChange !== undefined;
  useEffect(() => {
    if (!wanted) return undefined;
    latest.current?.(true);
    return () => latest.current?.(false);
  }, [wanted]);
}

export function NativeMessageList(props: ChatMessageListProps): JSX.Element {
  const list = useRef<ScrollView>(null);
  const toEnd = (): void => list.current?.scrollToEnd({ animated: true });
  useMountedVisibility(props.onVisibleChange);
  return (
    <ScrollView
      ref={list}
      style={styles.fill}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      // A new message grows the content; the keyboard opening shrinks the viewport. Either way, show the newest.
      onContentSizeChange={toEnd}
      onLayout={toEnd}
      accessibilityLabel={props.label}
      accessibilityLiveRegion="polite"
      testID={props.testID}
    >
      <Stack gap={1}>{props.children}</Stack>
    </ScrollView>
  );
}

export function NativeBubble(props: ChatBubbleProps): JSX.Element {
  const theme = useUiTheme();
  // One plain object, not a style array: the web type-check (`tsc -p tsconfig.json`) reads this
  // file against the web `Box`, whose `style` is CSS. An own bubble's tint replaces the paper surface.
  const style = props.mine ? { maxWidth: BUBBLE_MAX_WIDTH, backgroundColor: ownBubbleTint(theme) } : { maxWidth: BUBBLE_MAX_WIDTH };
  return (
    <Box bg={props.mine ? undefined : "paper"} bordered radius="md" px={2} py={1} gap={0.5} style={style}>
      {props.children}
    </Box>
  );
}
