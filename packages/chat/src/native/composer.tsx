/**
 * The React Native composer: the design system's native field and button.
 * The keyboard's send key submits; the field's own change event is
 * `onChangeText`, which is why this piece is per platform.
 */

import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/layout/Box";
import type { JSX } from "react";

import type { ChatComposerProps } from "../ui/thread-view";

/** The native field's change and submit events, which the web types do not carry. */
interface NativeFieldEvents {
  onChangeText: (text: string) => void;
  onSubmitEditing: () => void;
  returnKeyType: "send";
  accessibilityLabel: string;
}

export function NativeComposer(props: ChatComposerProps): JSX.Element {
  // The native Input accepts React Native's TextInput props; the shared type
  // checking this file sees the web declaration, so the native-only events
  // travel as one typed bag.
  const native: NativeFieldEvents = {
    onChangeText: props.onChange,
    onSubmitEditing: props.onSubmit,
    returnKeyType: "send",
    accessibilityLabel: props.copy.placeholder,
  };
  return (
    <Box direction="row" gap={1} align="center">
      <Box flex={1}>
        <Input
          fullWidth
          value={props.value}
          placeholder={props.copy.placeholder}
          maxLength={props.maxLength}
          disabled={props.sending}
          testID="chat-input"
          {...(native as object)}
        />
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
