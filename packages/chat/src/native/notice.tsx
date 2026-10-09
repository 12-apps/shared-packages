/**
 * The React Native send-failure notice: ui's alert, or — in the compact look —
 * an icon and at most two lines of small text on the composer, not a card
 * that takes the list's room on a small phone. Either way it is wrapped in a
 * view that reports its drawn height (`onHeight`), so a host sizing the room
 * around the thread can count it.
 */

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Icon } from "@12-apps/ui/icons";
import { Text } from "@12-apps/ui/typography/Text";
import type { JSX } from "react";
import { StyleSheet, View, type TextProps } from "react-native";

import type { ChatNoticeProps } from "../ui/thread-view";

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  text: { flexShrink: 1 },
});

/** A bag rather than an attribute, so the web type-check (which sees the web `Text`) accepts the file too. */
const TWO_LINES: Pick<TextProps, "numberOfLines"> = { numberOfLines: 2 };

export function NativeNotice(props: ChatNoticeProps): JSX.Element {
  return (
    <View
      onLayout={(event) => props.onHeight?.(Math.ceil(event.nativeEvent.layout.height))}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      testID={props.testID}
      style={props.compact ? styles.line : undefined}
    >
      {props.compact ? (
        <>
          <Icon name="WarningAmber" size={16} color={props.tone} />
          <Text variant="body" size="xs" color={props.tone} style={styles.text} {...TWO_LINES}>
            {props.text}
          </Text>
        </>
      ) : (
        <Alert variant="danger" description={props.text} />
      )}
    </View>
  );
}
