/**
 * The React Native composer: the design system's native field and button.
 * The keyboard's send key submits and the keyboard STAYS UP
 * (`submitBehavior="submit"`), so a conversation is typed without the
 * keyboard bouncing after every message; the field's own change event is
 * `onChangeText`, which is why this piece is per platform.
 *
 * The field stays editable while a message is in flight — making it inert
 * would close the keyboard. Only the send action is gated (here, and again in
 * the thread's submit).
 */

import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/layout/Box";
import type { JSX } from "react";
import type { TextInputProps } from "react-native";

import type { ChatComposerProps } from "../ui/thread-view";

/** The native field's own events, typed by react-native itself. */
type NativeFieldEvents = Required<
  Pick<TextInputProps, "onChangeText" | "onSubmitEditing" | "returnKeyType" | "submitBehavior" | "accessibilityLabel">
>;

export function NativeComposer(props: ChatComposerProps): JSX.Element {
  // A bag rather than attributes so the web type-check (`tsc -p tsconfig.json`,
  // which sees the web `Input`) accepts the file too; `tsconfig.native.json`
  // checks the same spread against the native `Input`.
  const native: NativeFieldEvents = {
    onChangeText: props.onChange,
    onSubmitEditing: props.onSubmit,
    returnKeyType: "send",
    submitBehavior: "submit",
    accessibilityLabel: props.copy.placeholder,
  };
  return (
    <Box direction="row" gap={1} align="center">
      <Box flex={1}>
        <Input fullWidth value={props.value} placeholder={props.copy.placeholder} maxLength={props.maxLength} testID="chat-input" {...native} />
      </Box>
      <Button
        variant="solid"
        onClick={props.onSubmit}
        disabled={props.sending || props.value.trim() === ""}
        testID="chat-send"
      >
        {props.sending ? props.copy.sending : props.copy.send}
      </Button>
    </Box>
  );
}
