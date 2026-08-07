"use client";

import AddLinkOutlinedIcon from "@mui/icons-material/AddLinkOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LinkOffOutlinedIcon from "@mui/icons-material/LinkOffOutlined";

import { ConfirmButton } from "@12-apps/ui/feedback/ConfirmAction";
import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { AiHostGuide } from "../guide";
import { HostBrandAvatar } from "./ai-icons";

/**
 * Revoke a host's access. Returning a promise holds the confirmation popup in
 * its pending state until the write settles, and a rejection keeps it open
 * carrying the reason — so the owner sees the disconnect finish or fail.
 */
export type DisconnectHandler = (hostId: string) => void | Promise<unknown>;

/** One assistant's connection state. */
export interface HostStatus {
  host: AiHostGuide;
  connected: boolean;
  /** Freeform activity line for a connected host (e.g. "ativo há 3 min"). */
  detail?: string;
}

/**
 * The right-hand side of a CONNECTED box: the green pill, plus the way back out
 * when the app supplies one. Without `onDisconnect` this is the pill alone — a
 * board with no revoke path must not offer a button that does nothing.
 */
function ConnectedControls({
  host,
  onDisconnect,
}: {
  host: AiHostGuide;
  onDisconnect?: DisconnectHandler;
}): React.JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
      <Box
        sx={{
          px: 1,
          py: 0.25,
          borderRadius: 999,
          bgcolor: "success.main",
          color: "success.contrastText",
        }}
      >
        <Text variant="caption" weight="bold" as="span">
          Conectado
        </Text>
      </Box>
      {onDisconnect ? (
        <ConfirmButton
          variant="outline"
          color="danger"
          size="sm"
          onClick={() => onDisconnect(host.id)}
          confirm={{
            title: "Desconectar o assistente?",
            entityName: host.label,
            description:
              "Ele perde o acesso à sua loja na hora. Para voltar a usar, será preciso conectar de novo.",
            confirmText: "Desconectar",
            dataTestId: `ai-status-disconnect-confirm-${host.id}`,
          }}
          data-testid={`ai-status-disconnect-${host.id}`}
        >
          <LinkOffOutlinedIcon sx={{ fontSize: 16, mr: 0.5 }} />
          Desconectar
        </ConfirmButton>
      ) : null}
    </Stack>
  );
}

/** A single green (connected) / red (to connect) status box for one assistant. */
function StatusBox({
  status,
  onConnect,
  onDisconnect,
}: {
  status: HostStatus;
  onConnect: (hostId: string) => void;
  onDisconnect?: DisconnectHandler;
}): React.JSX.Element {
  const { host, connected, detail } = status;
  return (
    <Box
      data-testid={`ai-status-${host.id}`}
      data-connected={connected}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        p: 2,
        borderRadius: 3,
        border: 1,
        borderColor: connected ? "success.main" : "error.main",
        bgcolor: "background.paper",
      }}
    >
      <HostBrandAvatar brand={host.brand} size={36} />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Text variant="body" weight="bold" as="span">
            {host.label}
          </Text>
          {connected ? <CheckCircleIcon sx={{ fontSize: 18, color: "success.main" }} /> : null}
        </Stack>
        <Text variant="caption" as="p" color="secondary">
          {connected ? (detail ?? "Conectado") : "Ainda não conectado"}
        </Text>
      </Box>
      {connected ? (
        <ConnectedControls host={host} onDisconnect={onDisconnect} />
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onConnect(host.id)}
          data-testid={`ai-status-connect-${host.id}`}
        >
          <AddLinkOutlinedIcon sx={{ fontSize: 16, mr: 0.5 }} />
          Conectar
        </Button>
      )}
    </Box>
  );
}

/**
 * The completed-state status board for the AI integration: every assistant as a
 * box — green when connected, red when still to connect (with a "Conectar"
 * button that re-enters the guided flow for that host). Each connection is
 * attributed to its provider (derived from the OAuth client + confirmed by
 * `announceAiConnection`), so several assistants can show connected at once.
 *
 * A connected box also carries the reverse action when the app passes
 * `onDisconnect`: revoking is the only way out of a finished connection, and
 * the board is the one place that names which assistants hold access — so
 * without it an owner who wants to cut a host off has nowhere to click.
 */
export function AiStatusBoard({
  statuses,
  onConnect,
  onDisconnect,
}: {
  statuses: readonly HostStatus[];
  onConnect: (hostId: string) => void;
  /** Revoke this host's access. Omit to render a read-only board. */
  onDisconnect?: DisconnectHandler;
}): React.JSX.Element {
  return (
    <Stack spacing={2} data-testid="ai-status-board">
      <Box>
        <Text variant="heading" size="sm" as="h2">
          Assistentes conectados
        </Text>
        <Text variant="caption" as="p" color="secondary">
          Em verde os que já operam a sua loja; em vermelho os que faltam conectar.
        </Text>
      </Box>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        }}
      >
        {statuses.map((status) => (
          <StatusBox
            key={status.host.id}
            status={status}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
          />
        ))}
      </Box>
    </Stack>
  );
}
