"use client";

import AddLinkOutlinedIcon from "@mui/icons-material/AddLinkOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { AiHostGuide } from "../guide";
import { HostBrandAvatar } from "./ai-icons";

/** One assistant's connection state. */
export interface HostStatus {
  host: AiHostGuide;
  connected: boolean;
  /** Freeform activity line for a connected host (e.g. "ativo há 3 min"). */
  detail?: string;
}

/** A single green (connected) / red (to connect) status box for one assistant. */
function StatusBox({
  status,
  onConnect,
}: {
  status: HostStatus;
  onConnect: (hostId: string) => void;
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
 */
export function AiStatusBoard({
  statuses,
  onConnect,
}: {
  statuses: readonly HostStatus[];
  onConnect: (hostId: string) => void;
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
          <StatusBox key={status.host.id} status={status} onConnect={onConnect} />
        ))}
      </Box>
    </Stack>
  );
}
