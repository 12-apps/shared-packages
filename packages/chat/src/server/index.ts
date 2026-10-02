/**
 * The one thing this package exposes to a BACKEND host: `createApiChat(config)
 * → { routes }`, plus `createChatReads` for the host's own lists.
 *
 * Routes are framework-neutral descriptors (the wiring `WireRoute` twin). A
 * host mounts one set per audience — each with its own `authorize`, which is
 * where every rule about who is in which thread lives — under a path that
 * names the subject. The package never learns what a thread is about.
 */

import { assertChatServerConfig, type ChatRoute, type ChatServerConfig } from "./context";
import { chatRoutes } from "./routes";

export function createApiChat<TActor = unknown>(config: ChatServerConfig<TActor>): { routes: ChatRoute<TActor>[] } {
  assertChatServerConfig(config as ChatServerConfig);
  return { routes: chatRoutes(config) };
}

export { createChatReads, type ChatReads, type UnreadCountsQuery } from "./reads";
export type {
  ChatAccess,
  ChatMessageEvent,
  ChatRequest,
  ChatResponse,
  ChatRoleConfig,
  ChatRoute,
  ChatServerConfig,
} from "./context";
export type { ChatDb, ChatMessageRow, ChatReadMarkerRow, ChatThreadRow } from "./db";
export type { ChatCopyResolver, ChatCopySource, ChatServerCopy } from "./copy";
export { PT_BR_CHAT_SERVER_COPY } from "./pt-BR";
export { EN_US_CHAT_SERVER_COPY } from "./en-US";
export { CHAT_SERVER_COPY } from "./locales";
