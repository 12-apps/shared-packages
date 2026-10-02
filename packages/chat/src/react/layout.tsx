/**
 * The web thread's frame and message list. The list is the design system's
 * scroll region, bounded to a share of the viewport so a long thread scrolls
 * inside it while the composer stays in view, and it follows the newest
 * message whenever one is added (a send, a reload that brought one in).
 */

import { ScrollArea } from "@12-apps/ui/layout/ScrollArea";
import { Stack } from "@12-apps/ui/layout/Stack";
import { useEffect, useRef, type JSX } from "react";

import type { ChatFrameProps, ChatMessageListProps } from "../ui/thread-view";

/** The list's ceiling: relative to the viewport, so it holds at every width and zoom. */
const LIST_MAX_HEIGHT = "60vh";

export function WebFrame(props: ChatFrameProps): JSX.Element {
  return (
    <Stack gap={2} testID={props.testID}>
      {props.children}
    </Stack>
  );
}

export function WebMessageList(props: ChatMessageListProps): JSX.Element {
  const viewport = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [props.scrollKey]);
  return (
    <ScrollArea regionLabel={props.label} scrollRef={viewport} height="auto" maxHeight={LIST_MAX_HEIGHT} testId={props.testID}>
      <Stack gap={1}>{props.children}</Stack>
    </ScrollArea>
  );
}
