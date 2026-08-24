import { EN_US_EVENTS_MESSAGES } from "./en-US";
import { PT_BR_EVENTS_MESSAGES } from "./pt-BR";
import type { EventsMessages } from "./types";

/**
 * Both languages, keyed by tag — what a host hands to `@12-apps/i18n` when the
 * reader's language is a property of the REQUEST rather than of the deployment.
 *
 * ```ts
 * import { localeCopy } from '@12-apps/i18n';
 * messages: localeCopy(EVENTS_MESSAGES),
 * ```
 *
 * `LocalePack` is declared here rather than imported from `@12-apps/i18n`, and
 * that is the design rather than an omission: this package is meant to be
 * liftable into a repo that has never heard of that one, and the mirror gives
 * the same key-checking for one line. `scripts/locale-coverage-gate.mjs` is
 * what keeps the two agreeing on which tags exist.
 *
 * The named single-language packs stay exported and unchanged. A host passing
 * `PT_BR_EVENTS_MESSAGES` by hand keeps working exactly as before — this is
 * additive, and pt-BR remains what every consumer renders today.
 */
type LocalePack<T> = { readonly "pt-BR": T; readonly "en-US": T };

export const EVENTS_MESSAGES = {
  "pt-BR": PT_BR_EVENTS_MESSAGES,
  "en-US": EN_US_EVENTS_MESSAGES,
} as const satisfies LocalePack<EventsMessages>;
