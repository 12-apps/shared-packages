import type { ChatServerCopy } from "./copy";
import { EN_US_CHAT_SERVER_COPY } from "./en-US";
import { PT_BR_CHAT_SERVER_COPY } from "./pt-BR";

/** Mirrored rather than imported, so the package stays liftable into any repo. */
type LocalePack<T> = { readonly "pt-BR": T; readonly "en-US": T };

/** Both languages, keyed by tag — what a host hands its i18n resolver. */
export const CHAT_SERVER_COPY = {
  "pt-BR": PT_BR_CHAT_SERVER_COPY,
  "en-US": EN_US_CHAT_SERVER_COPY,
} as const satisfies LocalePack<ChatServerCopy>;
