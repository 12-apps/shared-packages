/**
 * `@12-apps/chat/native` — the React Native host's surface:
 * `createNativeChat(config) → { ChatThread }`. The same thread screen as the
 * web surface, drawn with `@12-apps/ui`'s native primitives (its
 * `react-native` export condition), with a native composer.
 */

import { buildChatSurface, type ChatSurface, type ChatSurfaceConfig } from "../ui/surface";
import { NativeComposer } from "./composer";

export function createNativeChat(config: ChatSurfaceConfig): ChatSurface {
  return buildChatSurface(config, NativeComposer);
}

export type { ChatSurface, ChatSurfaceConfig, ChatThreadProps } from "../ui/surface";
