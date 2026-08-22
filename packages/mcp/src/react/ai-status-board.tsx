"use client";

import type { AiStatusBoardCopy } from "./copy";
import AddLinkOutlinedIcon from "@mui/icons-material/AddLinkOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LinkOffOutlinedIcon from "@mui/icons-material/LinkOffOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";

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
 * The right-hand side of a CONNECTED box: the green pill, then the two things
 * the pill alone left the owner unable to do.
 *
 * "{copy.instructions}" exists because the setup steps were reachable ONLY from a RED
 * card's "Conectar" — so on an all-green board there was no way to re-read how
 * any of them was connected, which is exactly when someone re-doing the setup on
 * a second machine needs them. It re-enters the same flow that button does.
 *
 * "Desconectar" is only drawn when the app supplies a revoke path: a board with
 * nowhere to send the revoke must not offer a button that does nothing.
 */
function ConnectedControls({
  host,
  onConnect,
  onDisconnect,
  copy,
}: {
  host: AiHostGuide;
  onConnect: (hostId: string) => void;
  onDisconnect?: DisconnectHandler;
  copy: AiStatusBoardCopy;
}): React.JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      justifyContent="flex-end"
      // Wraps rather than squeezing: three controls do not fit a half-width
      // card at every breakpoint.
      sx={{ flexShrink: 0, flexWrap: "wrap", rowGap: 0.5 }}
    >
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
      <Button
        variant="text"
        size="sm"
        onClick={() => onConnect(host.id)}
        data-testid={`ai-status-instructions-${host.id}`}
      >
        <MenuBookOutlinedIcon sx={{ fontSize: 16, mr: 0.5 }} />
        {copy.instructions}
      </Button>
      {onDisconnect ? (
        <ConfirmButton
          variant="outline"
          color="danger"
          size="sm"
          onClick={() => onDisconnect(host.id)}
          confirm={{
            title: copy.disconnectTitle,
            entityName: host.label,
            description:
              copy.disconnectBody,
            confirmText: copy.disconnectConfirm,
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
  copy,
}: {
  status: HostStatus;
  onConnect: (hostId: string) => void;
  onDisconnect?: DisconnectHandler;
  copy: AiStatusBoardCopy;
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
          {connected ? (detail ?? copy.connected) : copy.notConnected}
        </Text>
      </Box>
      {connected ? (
        <ConnectedControls copy={copy} host={host} onConnect={onConnect} onDisconnect={onDisconnect} />
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
 * A connected box carries two more controls, because the pill it used to show
 * alone was a dead end in both directions: "{copy.instructions}" re-enters the host's
 * setup steps (previously reachable only from a RED card, so an all-green board
 * hid them entirely), and "Desconectar" — when the app passes `onDisconnect` —
 * revokes access, which nothing in the UI could do at all.
 */
export function AiStatusBoard({
  statuses,
  onConnect,
  onDisconnect,
  copy,
}: {
  statuses: readonly HostStatus[];
  onConnect: (hostId: string) => void;
  /** Revoke this host's access. Omit to render a read-only board. */
  onDisconnect?: DisconnectHandler;
  copy: AiStatusBoardCopy;
}): React.JSX.Element {
  return (
    <Stack spacing={2} data-testid="ai-status-board">
      <Box>
        <Text variant="heading" size="sm" as="h2">
          {copy.boardTitle}
        </Text>
        <Text variant="caption" as="p" color="secondary">
          {copy.boardCaption}
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
          <StatusBox copy={copy}
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
