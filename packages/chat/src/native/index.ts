/**
 * `@12-apps/chat/native` — the React Native host's surface:
 * `createNativeChat(config) → { ChatThread }`. The same thread screen as the
 * web surface, drawn with `@12-apps/ui`'s native primitives (its
 * `react-native` export condition), with a native frame, list and composer.
 */

import { buildChatSurface, type ChatSurface, type ChatSurfaceConfig } from "../ui/surface";
import { NativeComposer } from "./composer";
import { NativeFrame, NativeMessageList } from "./layout";

export function createNativeChat(config: ChatSurfaceConfig): ChatSurface {
  return buildChatSurface(config, { Frame: NativeFrame, MessageList: NativeMessageList, Composer: NativeComposer });
}

export type { ChatSurface, ChatSurfaceConfig, ChatThreadProps } from "../ui/surface";
