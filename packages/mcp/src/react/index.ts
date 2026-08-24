/**
 * `@12-apps/mcp/react` — the reusable, app-agnostic AI/MCP connect onboarding UI.
 *
 * The app supplies the persistence `store`, the `endpointUrl`, and the live
 * `connection`; the flow's content (hosts, capabilities, copy) defaults to the
 * shared guide and can be overridden per app. React + MUI + `@12-apps/ui` +
 * `@12-apps/onboarding`; server-side MCP core stays on the package root export.
 */

export {
  AiIntegrationOnboarding,
  type AiIntegrationOnboardingProps,
  type AiConnection,
} from "./ai-onboarding";

// Building blocks + content, exported so apps can compose or override.
export { AiLanding } from "./ai-landing";
export { AiCapabilities } from "./ai-capabilities";
export { AiStatusBoard, type DisconnectHandler, type HostStatus } from "./ai-status-board";
export { HostSelectStep } from "./host-select-step";
export {
  EndpointCopyBlock,
  PromptCopyBlock,
  HostConnectHeader,
  HostOpenButton,
  HostStepList,
} from "./host-connect-guide";
export { McpEndpointUrl } from "./mcp-endpoint-url";
export { HostBrandAvatar, CapabilityIcon } from "./ai-icons";
export { FeatureBadge, type FeatureBadgeItem } from "./feature-badge";
export {
  aiConnectPrompt,
  type AiConnectPromptSpec,
  providerForHostId,
  type AiHostBrand,
  type AiHostLink,
  type AiHostConfigureStage,
  type AiHostGuide,
  type AiProvider,
  type AiCapability,
} from "../guide";

export {
  PT_BR_AI_CAPABILITIES,
  PT_BR_AI_CONNECT_PROMPT,
  PT_BR_AI_HOST_GUIDES,
  PT_BR_AI_PERMISSION_MODEL,
} from "../pt-BR";

// The English twins and the tag-keyed records, re-exported beside them so a
// screen reaching for the AI surface finds all of it on one subpath — which is
// how the pt-BR names have always been reachable from here.
export {
  EN_US_AI_CAPABILITIES,
  EN_US_AI_CONNECT_PROMPT,
  EN_US_AI_HOST_GUIDES,
  EN_US_AI_PERMISSION_MODEL,
} from "../en-US";
export {
  AI_CAPABILITIES,
  AI_CONNECT_PROMPT,
  AI_HOST_GUIDES,
  AI_PERMISSION_MODEL,
} from "../locales";

export type {
  AiCapabilitiesCopy,
  AiConnectGuideCopy,
  AiConnectionSummaryCopy,
  AiFlowCopy,
  AiHostSelectCopy,
  AiLandingCopy,
  AiOnboardingCopy,
  AiStatusBoardCopy,
  AiTrustPoint,
  McpAiCopy,
} from "./copy";
export { PT_BR_MCP_AI_COPY } from "./pt-BR";
export { EN_US_MCP_AI_COPY } from "./en-US";
export { MCP_AI_COPY } from "./locales";
