/**
 * The web composer: the design system's field and button, wired with the
 * DOM's change event. Enter sends; Shift+Enter is left to the field, and so is
 * the Enter that confirms an IME composition.
 *
 * The field stays enabled while a message is in flight: disabling it would
 * drop focus after every Enter. Only the send action is gated (here, and again
 * in the thread's submit). A click on the send button hands focus back to the
 * field: the button disables itself while the message is in flight, and a
 * focused control that turns disabled drops focus to the page.
 *
 * `maxLength` and the field's ref ride `inputProps`: given to `Input` itself
 * they land on the text field's root `<div>`, where neither means anything.
 */

import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Icon } from "@12-apps/ui/icons";
import { Box } from "@12-apps/ui/layout/Box";
import { useRef, type JSX, type KeyboardEvent } from "react";

import type { ChatComposerProps } from "../ui/thread-view";

export function WebComposer(props: ChatComposerProps): JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    props.onSubmit();
  };
  const onSend = (): void => {
    props.onSubmit();
    field.current?.focus();
  };
  return (
    <Box direction="row" gap={1} align="center">
      <Box flex={1}>
        <Input
          fullWidth
          value={props.value}
          placeholder={props.copy.placeholder}
          aria-label={props.copy.placeholder}
          inputProps={{ maxLength: props.maxLength, ref: field }}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={onKeyDown}
          testID="chat-input"
        />
      </Box>
      {/* Icon-only: the field says what it is for, the arrow is the act. Its name is the copy's. */}
      <Button
        variant="solid"
        icon={<Icon name="Send" size={18} />}
        aria-label={props.sending ? props.copy.sending : props.copy.send}
        title={props.copy.send}
        loading={props.sending}
        onClick={onSend}
        disabled={props.sending || props.value.trim() === ""}
        testID="chat-send"
      />
    </Box>
  );
}
