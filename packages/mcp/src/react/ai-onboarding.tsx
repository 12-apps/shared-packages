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
  AI_CONNECT_PROMPT,
  AI_HOST_GUIDES,
  AI_PERMISSION_MODEL,
  type AiCapability,
  type AiHostGuide,
} from "../guide";
import { AiLanding } from "./ai-landing";
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
  /** Assistants offered in the flow. @default the shared AI_HOST_GUIDES */
  hosts?: readonly AiHostGuide[];
  /** Capability cards on the landing. @default the shared AI_CAPABILITIES */
  capabilities?: readonly AiCapability[];
  /** Permission reassurance copy on the landing. @default AI_PERMISSION_MODEL */
  permissionModel?: string;
  /** Message pasted into the assistant on the Conectar step. @default AI_CONNECT_PROMPT */
  connectPrompt?: string;
  /**
   * Re-check the live connection on the verify step's "Testar conexão" button —
   * apps pass a router refresh (e.g. Next's `router.refresh`). @default a full
   * `window.location.reload()`.
   */
  onRetest?: () => void;
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
  devReset: boolean;
}

/**
 * The flow body — inside the OnboardingProvider so it can read the selected host
 * and pick the path. A host with a published `pluginUrl` gets the simplified
 * Escolher → Instalar → Confirmar flow (no URL to copy); otherwise the full
 * Escolher → Copiar URL → Configurar → Conectar → Confirmar flow.
 */
function AiOnboardingFlow(props: FlowProps): React.JSX.Element {
  const { endpointUrl, connections, hosts, capabilities, permissionModel, connectPrompt, onRetest, devReset } =
    props;
  const { state } = useOnboarding();
  const selectedHost = hosts.find((h) => h.id === state.data.selectedHost) ?? hosts[0]!;

  const steps = buildFlowSteps({ host: selectedHost, hosts, endpointUrl, connectPrompt, connections, onRetest });
  const connectedHostId = (state.data.connectedHost ?? state.data.selectedHost) as string | undefined;

  return (
    <GuidedSection
      steps={steps}
      title="Conecte assistentes de IA à sua loja"
      startLabel="Ver como conectar"
      renderLanding={(start) => (
        <AiLanding onStart={start} permissionModel={permissionModel} capabilities={capabilities} />
      )}
      configuredTitle={connectedTitle(connections, hosts, connectedHostId)}
      configuredSummary={connectedSummary(connections)}
      editLabel="Conectar IA"
      completedContent={(nav) => <StatusBoard nav={nav} connections={connections} hosts={hosts} />}
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
  hosts = AI_HOST_GUIDES,
  capabilities = AI_CAPABILITIES,
  permissionModel = AI_PERMISSION_MODEL,
  connectPrompt = AI_CONNECT_PROMPT,
  onRetest = () => {
    if (typeof window !== "undefined") window.location.reload();
  },
}: AiIntegrationOnboardingProps): React.JSX.Element {
  return (
    <OnboardingProvider featureKey={featureKey} store={store} initialState={initialState}>
      <AiOnboardingFlow
        endpointUrl={endpointUrl}
        connections={connections}
        hosts={hosts}
        capabilities={capabilities}
        permissionModel={permissionModel}
        connectPrompt={connectPrompt}
        onRetest={onRetest}
        devReset={devReset}
      />
    </OnboardingProvider>
  );
}
