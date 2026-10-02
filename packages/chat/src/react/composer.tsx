/**
 * The web composer: the design system's field and button, wired with the
 * DOM's change event. Enter sends; Shift+Enter is left to the field.
 */

import { Button } from "@12-apps/ui/form/Button";
import { Input } from "@12-apps/ui/form/Input";
import { Box } from "@12-apps/ui/layout/Box";
import type { JSX, KeyboardEvent } from "react";

import type { ChatComposerProps } from "../ui/thread-view";

export function WebComposer(props: ChatComposerProps): JSX.Element {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    props.onSubmit();
  };
  return (
    <Box direction="row" gap={1} align="center">
      <Box flex={1}>
        <Input
          fullWidth
          value={props.value}
          placeholder={props.copy.placeholder}
          aria-label={props.copy.placeholder}
          maxLength={props.maxLength}
          disabled={props.sending}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={onKeyDown}
          testID="chat-input"
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
