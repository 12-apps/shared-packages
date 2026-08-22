/**
 * AI-integration guide content — the reusable copy for a store's "Integração com
 * IA" onboarding. Pure, public, non-sensitive text (no React) so the on-page
 * walkthrough stays a portable, testable content module. Host brand marks/icons
 * and colours live in the components. Apps may pass their own overrides to
 * `<AiIntegrationOnboarding>`; these are the shared defaults.
 *
 * The MCP endpoint URL is NOT hardcoded here — the app derives it per request
 * from the deployment origin and passes it in.
 */

/** Which brand a host belongs to — drives the icon/accent in the UI. */
export type AiHostBrand = "claude" | "openai";

export interface AiHostLink {
  /** Deep-link straight to the host's connector settings, when one exists. */
  url: string;
  label: string;
}

/**
 * One stage of the "configure the connector" part of the flow. A host can split
 * configuration across several stages, each with its OWN deep link, step label
 * and instructions — e.g. ChatGPT needs "enable developer mode" (Security
 * settings) and then "configurar" (create the connector). When a host declares
 * `configureStages`, the wizard renders one wizard step per stage (between
 * "Copiar URL" and "Confirmar") instead of the default Configurar/Conectar
 * split, and the sign-in happens inside a stage — no prompt to paste.
 */
export interface AiHostConfigureStage {
  /** Stable id — also the wizard step id + test id suffix (`ai-stage-${id}`). */
  id: string;
  /** Step label shown in the stepper. */
  label: string;
  /** Optional deep link opened on this stage (unlocks "Próximo" once opened). */
  link?: AiHostLink;
  /** The instructions shown for this stage. */
  steps: readonly string[];
}

/**
 * The AI providers a connection can be attributed to — derived server-side from
 * the OAuth client's redirect URIs (and confirmed by the `announceAiConnection`
 * tool). Drives which host card lights up green on the status board.
 */
export type AiProvider = "claude" | "chatgpt" | "codex";

/** The provider a host id belongs to (claude-desktop shares Claude's provider). */
export function providerForHostId(hostId: string): AiProvider | null {
  if (hostId === "claude" || hostId === "claude-desktop") return "claude";
  if (hostId === "chatgpt") return "chatgpt";
  if (hostId === "codex") return "codex";
  return null;
}

export interface AiHostGuide {
  /** Stable id — also the panel test id suffix (`ai-setup-${id}`). */
  id: string;
  /** Tab label shown to the owner. */
  label: string;
  brand: AiHostBrand;
  /** One-line hint of what this host is (web app, desktop app, CLI…). */
  kind: string;
  /** Optional direct link button (desktop apps have no deep link). */
  link?: AiHostLink;
  /**
   * Optional link to the host's OFFICIAL connector docs — a stable vendor URL
   * shown as a "Para mais informações" reference (never a deep link with a
   * volatile connector id / UI params).
   */
  docs?: AiHostLink;
  steps: readonly string[];
  /**
   * Optional per-stage configuration (each with its own deep link + label). When
   * present, the wizard renders one step per stage in place of the default
   * Configurar → Conectar split, and `steps` mirrors the flattened stage
   * instructions so the MCP guide stays a single source of truth.
   */
  configureStages?: readonly AiHostConfigureStage[];
  /**
   * Optional deep link to a PUBLISHED one-click plugin/connector for this host
   * (set per app via env, e.g. `CHATGPT_PLUGIN_URL` / `CLAUDE_PLUGIN_URL`). When
   * present, the wizard swaps the manual "copy URL + configure connector" path
   * for a simplified "open → Install → authorize" flow: the owner never copies
   * the MCP URL. Absent → the full manual flow.
   */
  pluginUrl?: string;
}

export interface AiCapability {
  /** Stable id — maps to an icon in the component. */
  id: string;
  /** Card headline. */
  title: string;
  /** Short supporting line, usually an example prompt in quotes. */
  detail: string;
}


/**
 * The permission model in one line, shown prominently: the assistant acts AS
 * the signed-in owner (auth-passthrough) — it can do exactly what the owner
 * can, nothing more, and no extra credential/API key is ever created.
 *
 * A TYPE now, not a constant. The sentence is copy, and a package that shipped
 * it made one product's Portuguese every adopter's silent default.
 */
export type AiPermissionModel = string;

/** The two tools the paste-in prompt drives, and what to call the store id. */
export interface AiConnectPromptSpec {
  /**
   * The tool that REGISTERS the connection server-side, so the store learns
   * which assistant connected.
   */
  announceTool: string;
  /** A real READ tool, called straight after, to prove the access works. */
  probeTool: string;
  /** What that read returns, in the owner's own words ("o estoque da loja"). */
  probeSubject: string;
  /** What the assistant should ask for if it needs to identify the store. */
  identifierName: string;
}

/**
 * The message the owner pastes into the assistant's chat right after
 * connecting: announce the connection, then read something real to prove it
 * works. The owner types nothing.
 *
 * BUILT from the host's tool names rather than shipped with them. This was a
 * constant naming two tools — `announceAiConnection` and `listInventory` — that
 * THIS PACKAGE does not define or serve; they belong to one adopter's surface.
 * Any other host handed its owner a prompt instructing the assistant to call
 * two tools that do not exist, and because nothing registered the connection,
 * the wizard's confirm step then waited forever for a state that could never
 * arrive.

/**
 * The sentences the paste-in prompt is written in.
 *
 * A template rather than a string, because the prompt INTERPOLATES the host's
 * own tool names and its word order is language-specific. The package supplies
 * the spec; the host supplies the way it is said.
 */
export interface AiConnectPromptCopy {
  (spec: AiConnectPromptSpec): string;
}

/**
 * The message the owner pastes into the assistant's chat right after
 * connecting: announce the connection, then read something real to prove it
 * works. The owner types nothing.
 *
 * BUILT from the host's tool names rather than shipped with them. This was a
 * constant naming two tools — `announceAiConnection` and `listInventory` — that
 * THIS PACKAGE does not define or serve; they belong to one adopter's surface.
 * Any other host handed its owner a prompt instructing the assistant to call
 * two tools that do not exist, and because nothing registered the connection,
 * the wizard's confirm step then waited forever for a state that could never
 * arrive.
 *
 * The WORDS around those names are the host's too, since FUT-760: this is a
 * thin seam that hands the spec to the host's own template.
 */
export function aiConnectPrompt(spec: AiConnectPromptSpec, copy: AiConnectPromptCopy): string {
  return copy(spec);
}
