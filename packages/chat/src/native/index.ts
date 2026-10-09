/**
 * `@12-apps/chat/native` — the React Native host's surface:
 * `createNativeChat(config) → { ChatThread }`. The same thread screen as the
 * web surface, drawn with `@12-apps/ui`'s native primitives (its
 * `react-native` export condition), with a native frame, list and composer.
 */

import { ChatConfigError } from "../core/errors";
import { buildChatSurface, type ChatSurface, type ChatSurfaceConfig } from "../ui/surface";
import { NativeComposer } from "./composer";
import { NativeBubble, NativeFrame, NativeMessageList } from "./layout";
import { NativeNotice } from "./notice";
import { nativeQuickReplies, type NativeQuickReplyLook } from "./quick-replies";

/** The shared config, plus what only the native row draws. */
export interface NativeChatSurfaceConfig extends ChatSurfaceConfig {
  /**
   * `"chip"` (default): ui's outlined chips with a bolt, as on the web.
   * `"pill"`: neutral filled pills with bold labels, at least
   * `NATIVE_CHAT_METRICS.quickReplyMinHeight` (40) dp tall.
   */
  readonly quickReplyLook?: NativeQuickReplyLook;
  /**
   * Below this window width, in dp, the quick replies sit on one line that
   * scrolls sideways instead of wrapping. Default: they always wrap.
   */
  readonly quickReplyScrollBelowWidth?: number;
}

const LOOKS: readonly NativeQuickReplyLook[] = ["chip", "pill"];

export function createNativeChat(config: NativeChatSurfaceConfig): ChatSurface {
  const look = config?.quickReplyLook ?? "chip";
  if (!LOOKS.includes(look)) throw new ChatConfigError(`quickReplyLook must be one of ${LOOKS.join(", ")}.`);
  const below = config?.quickReplyScrollBelowWidth;
  if (below !== undefined && !(Number.isFinite(below) && below > 0)) {
    throw new ChatConfigError("quickReplyScrollBelowWidth must be a positive number of dp when given.");
  }
  return buildChatSurface(config, {
    Frame: NativeFrame,
    MessageList: NativeMessageList,
    Bubble: NativeBubble,
    Composer: NativeComposer,
    QuickReplies: nativeQuickReplies(look, below),
    Notice: NativeNotice,
  });
}

export { NATIVE_CHAT_METRICS, type NativeQuickReplyLook } from "./quick-replies";
export type { ChatSurface, ChatSurfaceConfig, ChatThreadProps } from "../ui/surface";
