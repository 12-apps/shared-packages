/**
 * `@12-apps/auth/react` — the "Acesso à conta" surface (FUT-873).
 *
 * The prototype that specifies this surface is not a mockup to copy: it names,
 * for each piece of markup, which `@12-apps/ui` component covers it, and its
 * own stylesheet exists so it can breathe without the library. So what lands
 * here is the MECHANISM the prototype settled — the states, the arrangements,
 * the flow — built out of the library, and never the prototype's CSS.
 *
 * ## The decisions this module exists to keep
 *
 * Each is a thing that reads as a bug when it is missing, and each was missing:
 *
 * - **Three states per screen**, and the empty ones are real configurations a
 *   store can be in rather than placeholders — so each carries a way forward.
 * - **The address crosses the whole flow.** Sign in → forgot → check mail →
 *   new password → sign in is five screens and one typed address.
 * - **A rate limit says how long.** "Aguarde alguns minutos" is
 *   indistinguishable from a broken screen.
 * - **"Confira seu e-mail" has a way back.** The commonest failure there is a
 *   typo, and a panel with no exit forces a reload and a full retype.
 * - **The card always says whose it is.** Nobody types a password without
 *   knowing where they are.
 * - **Responsive by arrangement, not by shrinking** — a card that merely
 *   narrows puts the submit button below the fold on a phone.
 *
 * What is NOT here: the words (a required pack, never defaulted), the branding
 * (the host resolves it from the store's plan), and the providers (an OAuth
 * button owns a callback URL and a redirect this package cannot know).
 */

export { AccessGate, accessState } from "./async-gate";
export type { AccessGateProps, AccessState } from "./async-gate";

export { AccessCard, AccessBrandHeader, TWO_COLUMN_WIDTH, FULL_BLEED_WIDTH } from "./card";
export type { AccessBrand, AccessCardProps } from "./card";

export { CheckEmailPanel } from "./check-email";
export type { CheckEmailCopy, CheckEmailPanelProps } from "./check-email";

export { rateLimitMessage } from "./rate-limit";
export type { RateLimitCopy } from "./rate-limit";

export { useFlowEmail } from "./flow-email";
export type { FlowEmail } from "./flow-email";

export type { AccessCopy } from "./copy";
export { PT_BR_ACCESS } from "./pt-BR";
export { EN_US_ACCESS } from "./en-US";
