/**
 * The web thread's frame, message list and bubble. The list is the design
 * system's scroll region, bounded to a share of the viewport so a long thread
 * scrolls inside it while the composer stays in view, and it follows the
 * newest message whenever one is added (a send, a reload that brought one in).
 * It is a polite live region, so a screen reader hears a message arrive
 * without the reader's place being taken from them.
 */

import { Box } from "@12-apps/ui/layout/Box";
import { ScrollArea } from "@12-apps/ui/layout/ScrollArea";
import { Stack } from "@12-apps/ui/layout/Stack";
import { useUiTheme } from "@12-apps/ui/provider";
import { useEffect, useRef, type JSX } from "react";

import { ownBubbleTint } from "../ui/bubble-tint";
import type { ChatBubbleProps, ChatFrameProps, ChatMessageListProps } from "../ui/thread-view";

/** The list's ceiling: relative to the viewport, so it holds at every width and zoom. */
const LIST_MAX_HEIGHT = "60vh";
/** A bubble's widest: a share of the thread, and never a line too long to read. */
const BUBBLE_MAX_WIDTH = "min(80%, 60ch)";
/** On screen from the first sliver: 0 catches entering, the next step a pixel or so in. */
const VISIBLE_THRESHOLDS = [0, 0.01];

export function WebFrame(props: ChatFrameProps): JSX.Element {
  return (
    <Stack gap={2} testID={props.testID}>
      {props.children}
    </Stack>
  );
}

/**
 * Tell `report` whether `element` is on screen, and `false` once it is gone.
 * A browser without IntersectionObserver reports it on screen at once: the
 * thread then marks read as it always did, rather than never.
 */
function observeVisibility(element: HTMLElement, report: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    report(true);
    return () => report(false);
  }
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries.at(-1);
      if (entry) report(entry.isIntersecting && entry.intersectionRatio > 0);
    },
    { threshold: VISIBLE_THRESHOLDS },
  );
  observer.observe(element);
  return () => {
    observer.disconnect();
    report(false);
  };
}

/** Report the viewport's visibility while the host asked for it; the latest callback, never a re-subscription. */
function useVisibility(viewport: { readonly current: HTMLDivElement | null }, onVisibleChange?: (visible: boolean) => void): void {
  const latest = useRef(onVisibleChange);
  useEffect(() => {
    latest.current = onVisibleChange;
  }, [onVisibleChange]);
  const wanted = onVisibleChange !== undefined;
  useEffect(() => {
    const element = viewport.current;
    if (!wanted || !element) return undefined;
    return observeVisibility(element, (visible) => latest.current?.(visible));
  }, [viewport, wanted]);
}

export function WebMessageList(props: ChatMessageListProps): JSX.Element {
  const viewport = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [props.scrollKey]);
  useVisibility(viewport, props.onVisibleChange);
  return (
    <ScrollArea regionLabel={props.label} scrollRef={viewport} height="auto" maxHeight={LIST_MAX_HEIGHT} testId={props.testID}>
      <Stack gap={1} aria-live="polite" testID={`${props.testID}-live`}>
        {props.children}
      </Stack>
    </ScrollArea>
  );
}

export function WebBubble(props: ChatBubbleProps): JSX.Element {
  const theme = useUiTheme();
  return (
    <Box
      bg={props.mine ? undefined : "paper"}
      bordered
      radius="md"
      px={2}
      py={1}
      gap={0.5}
      sx={{ maxWidth: BUBBLE_MAX_WIDTH, ...(props.mine ? { backgroundColor: ownBubbleTint(theme) } : {}) }}
    >
      {props.children}
    </Box>
  );
}
