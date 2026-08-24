import {
  EN_US_AI_CAPABILITIES,
  EN_US_AI_CONNECT_PROMPT,
  EN_US_AI_HOST_GUIDES,
  EN_US_AI_PERMISSION_MODEL,
} from "./en-US";
import type {
  AiCapability,
  AiConnectPromptSpec,
  AiHostGuide,
  AiPermissionModel,
} from "./guide";
import {
  PT_BR_AI_CAPABILITIES,
  PT_BR_AI_CONNECT_PROMPT,
  PT_BR_AI_HOST_GUIDES,
  PT_BR_AI_PERMISSION_MODEL,
} from "./pt-BR";

/**
 * The AI-integration surface in both languages, keyed by tag — what a host
 * hands to `@12-apps/i18n` when the reader's language is a property of the
 * request rather than of the deployment.
 *
 * Two of these are FUNCTIONS rather than tables, and stay so:
 *
 *  - `AI_HOST_GUIDES` takes the platform's name, because the ChatGPT consent
 *    screen shows an OAuth button labelled with whoever operates the server and
 *    the owner is told which button to click. It once named one particular
 *    tenant of one deployment, so every other adopter instructed its owners to
 *    click a button that does not exist.
 *  - `AI_CONNECT_PROMPT` takes the host's own tool names, which the assistant
 *    must call by the name they are registered under.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`.
 */
type LocalePack<T> = { readonly "pt-BR": T; readonly "en-US": T };

export const AI_HOST_GUIDES = {
  "pt-BR": PT_BR_AI_HOST_GUIDES,
  "en-US": EN_US_AI_HOST_GUIDES,
} as const satisfies LocalePack<(platformName: string) => readonly AiHostGuide[]>;

export const AI_CONNECT_PROMPT = {
  "pt-BR": PT_BR_AI_CONNECT_PROMPT,
  "en-US": EN_US_AI_CONNECT_PROMPT,
} as const satisfies LocalePack<(spec: AiConnectPromptSpec) => string>;

export const AI_CAPABILITIES = {
  "pt-BR": PT_BR_AI_CAPABILITIES,
  "en-US": EN_US_AI_CAPABILITIES,
} as const satisfies LocalePack<readonly AiCapability[]>;

export const AI_PERMISSION_MODEL = {
  "pt-BR": PT_BR_AI_PERMISSION_MODEL,
  "en-US": EN_US_AI_PERMISSION_MODEL,
} as const satisfies LocalePack<AiPermissionModel>;
