"use client";

import type { McpAiCopy } from "./copy";
import {
  GuidedSection,
  OnboardingProvider,
  useOnboarding,
  type OnboardingStateSnapshot,
  type OnboardingStore,
} from "@12-apps/onboarding";

import {
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
  /**
   * The onboarding namespace this flow's progress is stored under — the key
   * `@12-apps/onboarding` reads and writes, and the one the host's own
   * `featureKeys` allow-list has to contain.
   *
   * REQUIRED, on the same grounds as `hosts` and `copy` below. It defaulted to
   * `"ai_integration"`, which is one adopter's key: a host whose backend
   * declares `ai` or `mcp_connect` and says nothing here writes to a namespace
   * its own API rejects, so the wizard loses every step it saves and resumes
   * from nothing. Nothing warns, because a silent default is indistinguishable
   * from a deliberate one — and the failure only shows up as a refresh that
   * forgets, which reads as a bug in the host's persistence rather than as a
   * key nobody chose.
   */
  featureKey: string;
  /** Show the dev-only "reset onboarding" button. @default false */
  devReset?: boolean;
  /**
   * Assistants offered in the flow, with their step-by-step instructions.
   *
   * REQUIRED since FUT-760. These used to default to this package's own pt-BR
   * walkthrough, so a host that said nothing shipped one product's Portuguese
   * and had no field to decline it. `PT_BR_AI_HOST_GUIDES(platformName)` is that
   * exact content, now chosen by name.
   */
  hosts: readonly AiHostGuide[];
  /** Capability cards on the landing. REQUIRED — see `hosts`. */
  capabilities: readonly AiCapability[];
  /** Permission reassurance copy on the landing. REQUIRED — see `hosts`. */
  permissionModel: string;
  /** Every sentence the screens render. REQUIRED — see `hosts`. */
  copy: McpAiCopy;
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
  copy: McpAiCopy;
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
    copy,
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
    copy,
  });
  const connectedHostId = (state.data.connectedHost ??
    state.data.selectedHost) as string | undefined;

  return (
    <GuidedSection
      steps={steps}
      title={copy.onboarding.title}
      startLabel={copy.landing.start}
      renderLanding={(start) => (
        <AiLanding
          onStart={start}
          permissionModel={permissionModel}
          capabilities={capabilities}
          copy={copy.landing}
          capabilitiesCopy={copy.capabilities}
        />
      )}
      configuredTitle={connectedTitle(connections, hosts, connectedHostId, copy.summary)}
      configuredSummary={connectedSummary(connections, copy.summary)}
      editLabel={copy.onboarding.editLabel}
      collapseLabel={copy.onboarding.collapseLabel}
      completedContent={(nav) => (
        <StatusBoard
          nav={nav}
          connections={connections}
          hosts={hosts}
          onDisconnect={onDisconnect}
          copy={copy}
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
 * App-agnostic: the app supplies the persistence `store`, the `endpointUrl`, the
 * `featureKey` its own onboarding API serves, the live `connections` (one per
 * connected assistant), and every word on screen (`hosts`, `capabilities`,
 * `permissionModel`, `copy`). Nothing here has a default, because each of those
 * is a fact only the host holds and a default for it is silently wrong rather
 * than loudly missing.
 */
export function AiIntegrationOnboarding({
  store,
  endpointUrl,
  initialState,
  connections,
  featureKey,
  devReset = false,
  hosts,
  capabilities,
  permissionModel,
  connectPrompt,
  onRetest = () => {
    if (typeof window !== "undefined") window.location.reload();
  },
  onDisconnect,
  copy,
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
        copy={copy}
      />
    </OnboardingProvider>
  );
}
