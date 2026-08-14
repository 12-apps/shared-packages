"use client";

import {
  GuidedSection,
  OnboardingProvider,
  useOnboarding,
  type OnboardingStateSnapshot,
  type OnboardingStore,
} from "@12-apps/onboarding";

import {
  AI_CAPABILITIES,
  aiHostGuides,
  AI_PERMISSION_MODEL,
  type AiCapability,
  type AiHostGuide,
} from "../guide";
import { AiLanding } from "./ai-landing";
import type { DisconnectHandler } from "./ai-status-board";
import {
  buildFlowSteps,
  connectedSummary,
  connectedTitle,
  StatusBoard,
  type AiConnection,
} from "./ai-steps";

export type { AiConnection } from "./ai-steps";

const DEFAULT_FEATURE_KEY = "ai_integration";

/** Props for the reusable AI-connect onboarding flow. */
export interface AiIntegrationOnboardingProps {
  /** Persistence seam — the app wires this to its own backend (server actions). */
  store: OnboardingStore;
  /** The MCP endpoint URL to paste (derived by the app from its public origin). */
  endpointUrl: string;
  /** The owner's saved progress (null → first run / landing). */
  initialState: OnboardingStateSnapshot | null;
  /** The live MCP connections (one per connected assistant; empty when none). */
  connections: readonly AiConnection[];
  /** Onboarding feature key (persistence namespace). @default "ai_integration" */
  featureKey?: string;
  /** Show the dev-only "reset onboarding" button. @default false */
  devReset?: boolean;
  /**
   * The platform operating this MCP server, as its OAuth consent button names
   * it. REQUIRED, and it is the reason `hosts` can have a default at all: one
   * ChatGPT step tells the owner which "Sign in with …" button to click, and
   * that button carries whoever runs the server. It used to be a hard-coded
   * name — of a single STORE on one deployment, not even the product — so every
   * other adopter pointed its owners at a button that does not exist.
   */
  platformName: string;
  /** Assistants offered in the flow. @default aiHostGuides(platformName) */
  hosts?: readonly AiHostGuide[];
  /** Capability cards on the landing. @default the shared AI_CAPABILITIES */
  capabilities?: readonly AiCapability[];
  /** Permission reassurance copy on the landing. @default AI_PERMISSION_MODEL */
  permissionModel?: string;
  /**
   * Message the owner pastes into the assistant on the Conectar step.
   *
   * REQUIRED, with no default, because the useful version of it names TOOLS —
   * one to register the connection, one to read something real — and this
   * package neither defines nor serves any. It shipped a constant naming two
   * tools from one adopter's surface, so another host handed its owner a prompt
   * that called two things that did not exist, and the confirm step then waited
   * forever for a registration that could never happen. Build it with
   * `aiConnectPrompt({ … })`.
   */
  connectPrompt: string;
  /**
   * Re-check the live connection on the verify step's "Testar conexão" button —
   * apps pass a router refresh (e.g. Next's `router.refresh`). @default a full
   * `window.location.reload()`.
   */
  onRetest?: () => void;
  /**
   * Revoke a connected assistant's access, from the completed status board. The
   * host ID is the board's card, NOT the connection — `claude` and
   * `claude-desktop` share one provider, so the app resolves which stored
   * connection it owns (`providerForHostId`) and revokes that. Omitted → the
   * board stays read-only, which is the pre-existing behavior.
   */
  onDisconnect?: DisconnectHandler;
}

/** Resolved (defaults-applied) props threaded to the in-provider flow body. */
interface FlowProps {
  endpointUrl: string;
  connections: readonly AiConnection[];
  hosts: readonly AiHostGuide[];
  capabilities: readonly AiCapability[];
  permissionModel: string;
  connectPrompt: string;
  onRetest: () => void;
  onDisconnect: DisconnectHandler | undefined;
  devReset: boolean;
}

/**
 * The flow body — inside the OnboardingProvider so it can read the selected host
 * and pick the path. A host with a published `pluginUrl` gets the simplified
 * Escolher → Instalar → Confirmar flow (no URL to copy); otherwise the full
 * Escolher → Copiar URL → Configurar → Conectar → Confirmar flow.
 */
function AiOnboardingFlow(props: FlowProps): React.JSX.Element {
  const {
    endpointUrl,
    connections,
    hosts,
    capabilities,
    permissionModel,
    connectPrompt,
    onRetest,
    onDisconnect,
    devReset,
  } = props;
  const { state } = useOnboarding();
  const selectedHost =
    hosts.find((h) => h.id === state.data.selectedHost) ?? hosts[0]!;

  const steps = buildFlowSteps({
    host: selectedHost,
    hosts,
    endpointUrl,
    connectPrompt,
    connections,
    onRetest,
  });
  const connectedHostId = (state.data.connectedHost ??
    state.data.selectedHost) as string | undefined;

  return (
    <GuidedSection
      steps={steps}
      title="Conecte assistentes de IA à sua loja"
      startLabel="Ver como conectar"
      renderLanding={(start) => (
        <AiLanding
          onStart={start}
          permissionModel={permissionModel}
          capabilities={capabilities}
        />
      )}
      configuredTitle={connectedTitle(connections, hosts, connectedHostId)}
      configuredSummary={connectedSummary(connections)}
      editLabel="Conectar IA"
      completedContent={(nav) => (
        <StatusBoard
          nav={nav}
          connections={connections}
          hosts={hosts}
          onDisconnect={onDisconnect}
        />
      )}
      devReset={devReset}
      dataTestId="ai-onboarding"
    />
  );
}

/**
 * URL-free, persisted onboarding for the AI/MCP integration — a five-step wizard
 * (pick an assistant, copy the store URL, configure the connector, connect, then
 * verify) whose position + chosen assistant are saved via `@12-apps/onboarding`, so
 * a refresh resumes exactly where the owner left off. The live MCP connection
 * signal drives the verify step and the completed status board.
 *
 * App-agnostic: the app supplies the persistence `store`, the `endpointUrl`, and
 * the live `connections` (one per connected assistant); content (hosts,
 * capabilities, copy) defaults to the shared guide but can be overridden per app.
 */
export function AiIntegrationOnboarding({
  store,
  endpointUrl,
  initialState,
  connections,
  featureKey = DEFAULT_FEATURE_KEY,
  devReset = false,
  platformName,
  hosts = aiHostGuides(platformName),
  capabilities = AI_CAPABILITIES,
  permissionModel = AI_PERMISSION_MODEL,
  connectPrompt,
  onRetest = () => {
    if (typeof window !== "undefined") window.location.reload();
  },
  onDisconnect,
}: AiIntegrationOnboardingProps): React.JSX.Element {
  return (
    <OnboardingProvider
      featureKey={featureKey}
      store={store}
      initialState={initialState}
    >
      <AiOnboardingFlow
        endpointUrl={endpointUrl}
        connections={connections}
        hosts={hosts}
        capabilities={capabilities}
        permissionModel={permissionModel}
        connectPrompt={connectPrompt}
        onRetest={onRetest}
        onDisconnect={onDisconnect}
        devReset={devReset}
      />
    </OnboardingProvider>
  );
}
