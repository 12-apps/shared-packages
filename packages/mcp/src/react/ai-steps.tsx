"use client";

import { type GuidedNav, type GuidedStep } from "@12-apps/onboarding";

import { providerForHostId, type AiHostGuide } from "../guide";
import { activeAgo, resolveHost, type AiConnection } from "./ai-connection-utils";
import {
  ConfigureStageStep,
  ConfigureStep,
  ConfirmStep,
  ConnectStep,
  CopyUrlStep,
  InstallStep,
} from "./ai-flow-steps";
import { AiStatusBoard, type DisconnectHandler, type HostStatus } from "./ai-status-board";
import { HostSelectStep } from "./host-select-step";

export type { AiConnection } from "./ai-connection-utils";
export { connectedSummary, connectedTitle } from "./ai-connection-utils";

/** The completed status board: green for each connected host, red for the rest. */
export function StatusBoard({
  nav,
  connections,
  hosts,
  onDisconnect,
}: {
  nav: GuidedNav;
  connections: readonly AiConnection[];
  hosts: readonly AiHostGuide[];
  onDisconnect?: DisconnectHandler;
}): React.JSX.Element {
  const legacyHostId = (nav.data.connectedHost ?? nav.data.selectedHost) as string | undefined;

  const statuses: HostStatus[] = hosts.map((host) => {
    const provider = providerForHostId(host.id);
    // Prefer a provider-attributed connection; fall back to a legacy null-host
    // connection only for the host the owner completed the flow with.
    const connection =
      (provider ? connections.find((c) => c.host === provider) : undefined) ??
      (host.id === legacyHostId ? connections.find((c) => c.host === null) : undefined) ??
      null;
    return {
      host,
      connected: connection !== null,
      detail: connection ? activeAgo(connection.lastActiveAt) : undefined,
    };
  });

  /** Re-enter this host's setup — the manual copy path, or its one-click install. */
  const goToConnect = (hostId: string): void => {
    nav.goTo(hosts.find((h) => h.id === hostId)?.pluginUrl ? "install" : "copy", {
      selectedHost: hostId,
    });
  };

  /**
   * Disconnecting the LAST assistant leaves the section configured with nothing
   * configured: a collapsed "IA conectada" summary hiding an all-red board, with
   * the setup instructions two clicks away. So when the revoke empties the
   * board, walk straight back into that host's instructions — the owner who just
   * cut an assistant off is the likeliest person to reconnect one, and the steps
   * are the only thing left worth showing.
   *
   * Cutting one of SEVERAL leaves the board meaningful, so it stays put.
   * `statuses` is the pre-revoke picture, which is what makes "was that the last
   * one?" answerable here without waiting for the app to re-read.
   */
  const disconnect: DisconnectHandler | undefined = onDisconnect
    ? async (hostId) => {
        await onDisconnect(hostId);
        const revoked = providerForHostId(hostId);
        const othersLive = statuses.some(
          (status) => status.connected && providerForHostId(status.host.id) !== revoked,
        );
        if (!othersLive) goToConnect(hostId);
      }
    : undefined;

  return (
    <AiStatusBoard statuses={statuses} onConnect={goToConnect} onDisconnect={disconnect} />
  );
}

/** The first step (host picker) — picking a card advances to the right path. */
function selectStep(hosts: readonly AiHostGuide[]): GuidedStep {
  return {
    id: "select",
    label: "Escolher",
    render: (nav: GuidedNav) => (
      <HostSelectStep
        hosts={hosts}
        selectedId={(nav.data.selectedHost as string | undefined) ?? null}
        onSelect={(hostId) =>
          nav.goTo(hosts.find((h) => h.id === hostId)?.pluginUrl ? "install" : "copy", {
            selectedHost: hostId,
          })
        }
      />
    ),
  };
}

/** The Copiar-URL step, shared by every manual flow. */
function copyStep(endpointUrl: string): GuidedStep {
  return {
    id: "copy",
    label: "Copiar URL",
    render: (nav: GuidedNav) => <CopyUrlStep nav={nav} endpointUrl={endpointUrl} />,
  };
}

/**
 * The middle steps for the full manual flow. A host with `configureStages`
 * (e.g. ChatGPT) gets one step per stage — each with its own deep link — after
 * Copiar URL; otherwise the default copy → configure → connect split.
 */
function manualMiddle(
  host: AiHostGuide,
  hosts: readonly AiHostGuide[],
  endpointUrl: string,
  connectPrompt: string,
): GuidedStep[] {
  if (host.configureStages && host.configureStages.length > 0) {
    return [
      copyStep(endpointUrl),
      ...host.configureStages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        render: (nav: GuidedNav) => (
          <ConfigureStageStep nav={nav} host={resolveHost(hosts, nav.data.selectedHost)} stage={stage} />
        ),
      })),
    ];
  }
  return [
    copyStep(endpointUrl),
    {
      id: "configure",
      label: "Configurar",
      render: (nav: GuidedNav) => <ConfigureStep nav={nav} host={resolveHost(hosts, nav.data.selectedHost)} />,
    },
    {
      id: "connect",
      label: "Conectar",
      render: (nav: GuidedNav) => (
        <ConnectStep nav={nav} host={resolveHost(hosts, nav.data.selectedHost)} connectPrompt={connectPrompt} />
      ),
    },
  ];
}

/** The single middle step for the simplified plugin flow: install. */
function simpleMiddle(hosts: readonly AiHostGuide[], connectPrompt: string): GuidedStep[] {
  return [
    {
      id: "install",
      label: "Instalar",
      render: (nav: GuidedNav) => (
        <InstallStep nav={nav} host={resolveHost(hosts, nav.data.selectedHost)} connectPrompt={connectPrompt} />
      ),
    },
  ];
}

/**
 * Build the wizard's steps for the selected host's path: the simplified
 * `install` flow when the host has a published `pluginUrl`, the per-stage flow
 * when it declares `configureStages`, otherwise the full copy → configure →
 * connect flow. `select` and `confirm` bookend all of them.
 */
export function buildFlowSteps(opts: {
  host: AiHostGuide;
  hosts: readonly AiHostGuide[];
  endpointUrl: string;
  connectPrompt: string;
  connections: readonly AiConnection[];
  onRetest: () => void;
}): GuidedStep[] {
  const { host, hosts, endpointUrl, connectPrompt, connections, onRetest } = opts;
  const middle = host.pluginUrl
    ? simpleMiddle(hosts, connectPrompt)
    : manualMiddle(host, hosts, endpointUrl, connectPrompt);
  const confirm: GuidedStep = {
    id: "confirm",
    label: "Confirmar",
    render: (nav: GuidedNav) => (
      <ConfirmStep nav={nav} connections={connections} hosts={hosts} onRetest={onRetest} />
    ),
  };
  return [selectStep(hosts), ...middle, confirm];
}
