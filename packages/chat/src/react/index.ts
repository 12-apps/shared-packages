/**
 * `@12-apps/chat/react` — the web host's surface: `createWebChat(config) →
 * { ChatThread }`. One component per thread; the host decides where it sits.
 * Members are component TYPES — build once per config (the wiring binder does).
 */

import { buildChatSurface, type ChatSurface, type ChatSurfaceConfig } from "../ui/surface";
import { WebComposer } from "./composer";
import { ChipQuickReplies } from "../ui/thread-view";
import { WebBubble, WebFrame, WebMessageList } from "./layout";
import { WebNotice } from "./notice";

export function createWebChat(config: ChatSurfaceConfig): ChatSurface {
  return buildChatSurface(config, {
    Frame: WebFrame,
    MessageList: WebMessageList,
    Bubble: WebBubble,
    Composer: WebComposer,
    QuickReplies: ChipQuickReplies,
    Notice: WebNotice,
  });
}

export type { ChatSurface, ChatSurfaceConfig, ChatThreadProps } from "../ui/surface";
