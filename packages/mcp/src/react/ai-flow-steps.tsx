"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useEffect, useState } from "react";

import { type GuidedNav } from "@12-apps/onboarding";
import { Progress } from "@12-apps/ui/data-display/Progress";
import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { AiHostConfigureStage, AiHostGuide } from "../guide";
import { activeAgo, connectionForHost, hostLabel, type AiConnection } from "./ai-connection-utils";
import {
  EndpointCopyBlock,
  HostConnectHeader,
  HostDocsLink,
  HostOpenButton,
  HostStepList,
  PromptCopyBlock,
} from "./host-connect-guide";

/** The host's connect steps split across the Configurar / Conectar stages. */
const CONFIGURE_STEP_COUNT = 3;

/** How often the Confirmar step re-checks the live connection while waiting. */
const POLL_INTERVAL_MS = 3000;

/** A step's continue/back controls (Voltar left, primary next right). */
function StepNav({
  nav,
  onNext,
  nextLabel = "Próximo",
  nextDisabled = false,
  nextTestId,
}: {
  nav: GuidedNav;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextTestId?: string;
}): React.JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
      <Button variant="ghost" onClick={() => nav.back()} data-testid="ai-step-back">
        Voltar
      </Button>
      <Button onClick={onNext} disabled={nextDisabled} data-testid={nextTestId}>
        {nextLabel}
      </Button>
    </Stack>
  );
}

/** Step 2 — copy the store URL; copying is the action that advances the wizard. */
export function CopyUrlStep({ nav, endpointUrl }: { nav: GuidedNav; endpointUrl: string }): React.JSX.Element {
  return (
    <Stack spacing={3} data-testid="ai-copy-step">
      <Box>
        <Text variant="heading" size="sm" as="h2">
          Copie a URL da sua loja
        </Text>
        <Text variant="caption" as="p" color="secondary">
          É o único dado que você cola no assistente — ao copiar, seguimos para o próximo passo.
        </Text>
      </Box>
      <EndpointCopyBlock endpointUrl={endpointUrl} copied={false} onCopy={() => nav.next()} />
      <Box>
        <Button variant="ghost" onClick={() => nav.back()} data-testid="ai-step-back">
          Voltar
        </Button>
      </Box>
    </Stack>
  );
}

/** Step 3 — open the host's connectors and add + configure the custom connector. */
export function ConfigureStep({ nav, host }: { nav: GuidedNav; host: AiHostGuide }): React.JSX.Element {
  // Hosts with no direct link (e.g. Claude Desktop) have nothing to open, so
  // "Próximo" is available immediately; otherwise it unlocks on the open click.
  const [opened, setOpened] = useState(!host.link);
  return (
    <Stack spacing={2.5} data-testid="ai-configure-step">
      <HostConnectHeader host={host} />
      <HostOpenButton host={host} onOpen={() => setOpened(true)} />
      <HostStepList steps={host.steps.slice(0, CONFIGURE_STEP_COUNT)} start={1} />
      <HostDocsLink host={host} />
      <StepNav nav={nav} onNext={() => nav.next()} nextDisabled={!opened} nextTestId="ai-configure-next" />
    </Stack>
  );
}

/**
 * One stage of a host's per-stage configuration (e.g. ChatGPT's "enable
 * developer mode" then "configurar"). Each stage has its OWN deep link — opening
 * it unlocks "Próximo" — and its own instructions.
 */
export function ConfigureStageStep({
  nav,
  host,
  stage,
}: {
  nav: GuidedNav;
  host: AiHostGuide;
  stage: AiHostConfigureStage;
}): React.JSX.Element {
  const [opened, setOpened] = useState(!stage.link);
  return (
    <Stack spacing={2.5} data-testid={`ai-stage-${stage.id}`}>
      <HostConnectHeader host={host} />
      {stage.link && (
        <Box>
          <Button
            onClick={() => {
              window.open(stage.link!.url, "_blank", "noopener,noreferrer");
              setOpened(true);
            }}
            data-testid={`ai-stage-link-${stage.id}`}
          >
            {stage.link.label}
            <OpenInNewIcon sx={{ fontSize: 16, ml: 0.5 }} />
          </Button>
        </Box>
      )}
      <HostStepList steps={stage.steps} start={1} />
      <HostDocsLink host={host} />
      <StepNav
        nav={nav}
        onNext={() => nav.next()}
        nextDisabled={!opened}
        nextTestId={`ai-stage-next-${stage.id}`}
      />
    </Stack>
  );
}

/** Step 4 — connect: log in, authorize and activate the connector. */
export function ConnectStep({
  nav,
  host,
  connectPrompt,
}: {
  nav: GuidedNav;
  host: AiHostGuide;
  connectPrompt: string;
}): React.JSX.Element {
  return (
    <Stack spacing={2.5} data-testid="ai-connect-step">
      <HostConnectHeader host={host} />
      <HostStepList steps={host.steps.slice(CONFIGURE_STEP_COUNT)} start={CONFIGURE_STEP_COUNT + 1} />
      <PromptCopyBlock
        title="Cole esta mensagem no assistente"
        caption="Assim ele se conecta, se identifica (Claude, ChatGPT…) e registramos a conexão."
        message={connectPrompt}
      />
      <HostDocsLink host={host} />
      <StepNav nav={nav} onNext={() => nav.next()} nextLabel="Continuar" nextTestId="ai-connect-done" />
    </Stack>
  );
}

/**
 * Simplified-flow step (host has a published `pluginUrl`): open the one-click
 * plugin (install + authorize), then paste the prompt asking the assistant to
 * connect. No URL to copy, no manual connector. The next step (Confirmar) waits.
 */
export function InstallStep({
  nav,
  host,
  connectPrompt,
}: {
  nav: GuidedNav;
  host: AiHostGuide;
  connectPrompt: string;
}): React.JSX.Element {
  const [opened, setOpened] = useState(false);
  return (
    <Stack spacing={2.5} data-testid="ai-install-step">
      <HostConnectHeader host={host} />
      <Text variant="body" as="p" color="secondary">
        Abra o plugin da sua loja, clique em Instalar e autorize o acesso — sem copiar URL nem gerar
        credenciais.
      </Text>
      {host.pluginUrl && (
        <Box>
          <Button
            onClick={() => {
              window.open(host.pluginUrl!, "_blank", "noopener,noreferrer");
              setOpened(true);
            }}
            data-testid="ai-install-open"
          >
            Instalar o plugin da loja
            <OpenInNewIcon sx={{ fontSize: 16, ml: 0.5 }} />
          </Button>
        </Box>
      )}
      <PromptCopyBlock
        title="Peça ao assistente para conectar"
        caption="Cole no assistente para ele se conectar, se identificar e confirmar o acesso."
        message={connectPrompt}
      />
      <HostDocsLink host={host} />
      <StepNav
        nav={nav}
        onNext={() => nav.next()}
        nextLabel="Continuar"
        nextDisabled={!opened}
        nextTestId="ai-install-done"
      />
    </Stack>
  );
}

/**
 * Step 5: auto-detect the live connection. While waiting it polls the server
 * (the sign-in / `announceAiConnection` tool call registers the connection
 * server-side), showing a spinner — the owner never clicks "verify". Completes
 * when the selected host's connection appears.
 */
export function ConfirmStep({
  nav,
  connections,
  hosts,
  onRetest,
}: {
  nav: GuidedNav;
  connections: readonly AiConnection[];
  hosts: readonly AiHostGuide[];
  onRetest: () => void;
}): React.JSX.Element {
  const selectedHostId = nav.data.selectedHost as string | undefined;
  const connection = connectionForHost(connections, selectedHostId);
  const label = connection?.clientName ?? hostLabel(hosts, selectedHostId);

  // Auto-detect: re-check on an interval until the connection shows up. The
  // interval is cleared as soon as `connection` is non-null (and on unmount).
  useEffect(() => {
    if (connection) return undefined;
    const id = setInterval(() => onRetest(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [connection, onRetest]);

  if (connection) {
    return (
      <Stack spacing={2} data-testid="ai-confirm-connected">
        <Stack direction="row" spacing={1.5} alignItems="center">
          <CheckCircleIcon sx={{ color: "success.main" }} />
          <Box>
            <Text variant="body" weight="bold" as="p">
              {label} está conectado à sua loja.
            </Text>
            <Text variant="caption" as="p" color="secondary">
              {activeAgo(connection.lastActiveAt)}
            </Text>
          </Box>
        </Stack>
        <Box>
          <Button onClick={() => nav.complete({ connectedHost: selectedHostId })}>Concluir</Button>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5} data-testid="ai-confirm-waiting">
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Progress variant="circular" circularSize={22} thickness={4} dataTestId="ai-confirm-spinner" />
        <Box>
          <Text variant="body" weight="bold" as="p">
            Esperando conexão
          </Text>
          <Text variant="caption" as="p" color="secondary">
            Assim que você autorizar o acesso no {label}, ela aparece aqui automaticamente.
          </Text>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button variant="ghost" size="sm" onClick={onRetest} data-testid="ai-confirm-retest">
          Testar agora
        </Button>
        <Button variant="ghost" size="sm" onClick={() => nav.back()}>
          Voltar
        </Button>
      </Stack>
    </Stack>
  );
}
