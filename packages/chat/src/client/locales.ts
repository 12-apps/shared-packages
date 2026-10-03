import type { ChatUiCopy } from "./copy";
import { EN_US_CHAT_UI_COPY } from "./en-US";
import { PT_BR_CHAT_UI_COPY } from "./pt-BR";

/** Mirrored rather than imported, so the package stays liftable into any repo. */
type LocalePack<T> = { readonly "pt-BR": T; readonly "en-US": T };

/** Both languages, keyed by tag. */
export const CHAT_UI_COPY = {
  "pt-BR": PT_BR_CHAT_UI_COPY,
  "en-US": EN_US_CHAT_UI_COPY,
} as const satisfies LocalePack<ChatUiCopy>;
