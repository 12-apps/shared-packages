/**
 * The React Native thread's frame and message list.
 *
 * The frame is the design system's `Screen` with its own scrolling off and no
 * safe-area edges (the host's screen owns those): it fills its parent and
 * lifts above the soft keyboard, so the composer pinned under the list is
 * never covered. The list is a `ScrollView` that follows the newest message
 * whenever its content grows or its viewport shrinks (the keyboard opening),
 * and lets a tap on the send button land while the keyboard is up.
 *
 * Mount the thread in a bounded parent (a `Screen` with `scroll={false}`, a
 * flex-1 view) — inside another ScrollView it has no height to fill. Pass
 * `keyboardOffset` when a navigator header sits above it.
 */

import { Screen } from "@12-apps/ui/layout/Screen";
import { Stack } from "@12-apps/ui/layout/Stack";
import { useRef, type JSX } from "react";
import { ScrollView, StyleSheet } from "react-native";

import type { ChatFrameProps, ChatMessageListProps } from "../ui/thread-view";

const NO_EDGES = [] as const;
const styles = StyleSheet.create({ fill: { flex: 1 } });

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

export function NativeMessageList(props: ChatMessageListProps): JSX.Element {
  const list = useRef<ScrollView>(null);
  const toEnd = (): void => list.current?.scrollToEnd({ animated: true });
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
      testID={props.testID}
    >
      <Stack gap={1}>{props.children}</Stack>
    </ScrollView>
  );
}
