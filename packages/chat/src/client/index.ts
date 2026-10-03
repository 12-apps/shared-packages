/**
 * `@12-apps/chat/client` — platform-free: the HTTP client, the thread state
 * hook, and the screen's copy packs. Both surfaces are built on it; a host
 * drawing its own thread UI can use it directly.
 */
export { ChatClientError, createChatClient, type ChatClient, type ChatFetch, type ChatSendInput } from "./api";
export {
  useChatThread,
  type ChatAutoMarkRead,
  type ChatSendFailure,
  type ChatThreadControls,
  type ChatThreadPhase,
  type ChatThreadState,
} from "./use-chat-thread";
export type { ChatUiCopy } from "./copy";
export { PT_BR_CHAT_UI_COPY } from "./pt-BR";
export { EN_US_CHAT_UI_COPY } from "./en-US";
export { CHAT_UI_COPY } from "./locales";
