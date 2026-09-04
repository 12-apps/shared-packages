/**
 * Both languages of the gesture's copy — importable WITHOUT reaching the
 * invite's packs, which is the whole point. See `pull-to-refresh.pt-BR.ts`.
 */
import type { PullToRefreshMessages } from "./messages";
import { EN_US_PULL_TO_REFRESH_MESSAGES } from "./pull-to-refresh.en-US";
import { PT_BR_PULL_TO_REFRESH_MESSAGES } from "./pull-to-refresh.pt-BR";

/** Mirrored rather than imported, exactly as `locales.ts` mirrors it and for the same reason. */
type LocalePack<T> = { readonly "pt-BR": T; readonly "en-US": T };

export const PULL_TO_REFRESH_MESSAGES = {
  "pt-BR": PT_BR_PULL_TO_REFRESH_MESSAGES,
  "en-US": EN_US_PULL_TO_REFRESH_MESSAGES,
} as const satisfies LocalePack<PullToRefreshMessages>;
