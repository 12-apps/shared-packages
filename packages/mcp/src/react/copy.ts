import type { ConfirmActionCopy } from "@12-apps/ui/copy";
/**
 * Every word the AI-integration screens render, as REQUIRED host config
 * (FUT-760).
 *
 * These components used to take `capabilities` / `permissionModel` / `hosts` as
 * OPTIONAL props defaulting to this package's own pt-BR, and to compile the rest
 * of their sentences in outright. `guide.ts` even said so — "these are the
 * shared defaults" — which is the anti-pattern named exactly: a host that
 * configured nothing shipped one product's Portuguese, and nothing failed to
 * say so.
 *
 * Split per screen rather than one flat map, because three of them
 * (`AiLanding`, `AiCapabilities`, `AiStatusBoard`, `HostSelectStep`) are
 * exported standalone and a host mounting only one should not have to supply
 * words for screens it never renders.
 */

/** The marketing block's headline and its supporting line. */
export interface AiCapabilitiesCopy {
  heading: string;
  subheading: string;
}

/** One reassurance chip on the landing: an icon's label and its caption. */
export interface AiTrustPoint {
  /** Stable id — maps to the icon in the component. */
  id: string;
  label: string;
  caption: string;
}

export interface AiLandingCopy {
  /** Small line above the headline. */
  eyebrow: string;
  /**
   * The headline, in the three runs it renders as: lead, the EMPHASISED
   * middle (drawn in the accent colour), then the tail. `titleTail` was the
   * only one a host could set, so two thirds of this product's headline —
   * `Conecte` and `assistentes de IA` — shipped as literals around it.
   */
  titleLead: string;
  titleEmphasis: string;
  /** The headline's last run, after the emphasised middle. */
  titleTail: string;
  /** The paragraph under the headline. */
  lede: string;
  /** The reassurance strip. Order is the order rendered. */
  trust: readonly AiTrustPoint[];
  /** The call to action that starts the guided flow. */
  start: string;
}

/** The wizard's step labels, in the order the stepper shows them. */
export interface AiFlowStepLabels {
  select: string;
  copyUrl: string;
  configure: string;
  connect: string;
  install: string;
  confirm: string;
}

/** The wizard's navigation words and each step's own sentences. */
export interface AiFlowCopy {
  /** The stepper's labels. Not sentences, but still the host's words. */
  steps: AiFlowStepLabels;
  back: string;
  next: string;
  advance: string;
  finish: string;
  copyUrl: string;
  copied: string;
  copyMessage: string;
  /** The copy-the-URL step's heading. Names the host's own noun for a tenant. */
  copyUrlTitle: string;
  /** Under the MCP URL: what this value is and what happens on copy. */
  urlCaption: string;
  /** Under the paste-in prompt: what the assistant will do with it. */
  promptCaption: string;
  /** The "ask the assistant to connect" step heading. */
  askTitle: string;
  /** The one-click install step's body, for a host with a published plugin. */
  installBody: string;
  /** The install button on that step. */
  installAction: string;
  /** Heading over the paste-in message on the manual path. */
  pasteTitle: string;
  /** Caption under the paste-in message on the install path. */
  pasteInstallCaption: string;
  /** Confirmation once a host reports in. */
  connectedTo(hostLabel: string): string;
  waitingTitle: string;
  waitingBody(hostLabel: string): string;
  testNow: string;
}

export interface AiStatusBoardCopy {
  instructions: string;
  connected: string;
  notConnected: string;
  connect: string;
  disconnect: string;
  disconnectTitle: string;
  disconnectBody: string;
  disconnectConfirm: string;
  /** Shown when the disconnect write fails without a reason of its own. */
  disconnectError: string;
  boardTitle: string;
  boardCaption: string;
  /**
   * The confirmation popup's own furniture — its cancel button and fallbacks.
   * `@12-apps/ui` stopped shipping defaults for these (FUT-760), so the words
   * arrive here rather than from the design system's Portuguese.
   */
  confirmAction: ConfirmActionCopy;
}

/**
 * The one-line summary of a connection's recency.
 *
 * Functions rather than strings because the number is interpolated and the
 * plural rule is the host language's, not this package's.
 */
export interface AiConnectionSummaryCopy {
  /** Active within the last minute — no number to interpolate. */
  activeNow: string;
  activeMinutes(minutes: number): string;
  activeHours(hours: number): string;
  activeDays(days: number): string;
  /** Connected, but too long ago to state a recency for. */
  configured: string;
  /** Appended after a host's name: `Claude Conectado`. */
  connectedSuffix: string;
  /** Several assistants at once, from an already-joined list of names. */
  connectedSeveral(names: string): string;
  /** Connected, but the provider was never attributed to a known assistant. */
  connectedGeneric: string;
}

export interface AiHostSelectCopy {
  /** The step's own heading, above the host tiles. */
  heading: string;
  /** Why the owner is picking, under the host tiles. */
  caption: string;
}

export interface AiConnectGuideCopy {
  /** The label on the MCP URL field. Names the host's own noun for a tenant. */
  urlLabel: string;
  /** Above the MCP URL field. */
  urlHint: string;
  /** Lead-in to the vendor's official connector docs link. */
  moreInfo: string;
  connectOn(hostLabel: string): string;
}

export interface AiOnboardingCopy {
  title: string;
  /** The reveal toggle in the configured state, and its collapsed twin. */
  editLabel: string;
  collapseLabel: string;
}

/** Every screen's words, for a host mounting the whole flow. */
export interface McpAiCopy {
  capabilities: AiCapabilitiesCopy;
  landing: AiLandingCopy;
  flow: AiFlowCopy;
  statusBoard: AiStatusBoardCopy;
  summary: AiConnectionSummaryCopy;
  hostSelect: AiHostSelectCopy;
  connectGuide: AiConnectGuideCopy;
  onboarding: AiOnboardingCopy;
}
