"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";

import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { AiHostGuide } from "../guide";
import { HostBrandAvatar } from "./ai-icons";

/** One selectable assistant card (brand mark + name + kind, checked when active). */
function HostCard({
  host,
  active,
  onSelect,
}: {
  host: AiHostGuide;
  active: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      data-testid={`ai-host-card-${host.id}`}
      sx={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        p: 2,
        borderRadius: 3,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        border: 2,
        borderColor: active ? "primary.main" : "divider",
        bgcolor: active ? "action.selected" : "background.paper",
        transition: (theme) => theme.transitions.create(["border-color", "background-color"]),
        "&:hover": { borderColor: "primary.main" },
      }}
    >
      <HostBrandAvatar brand={host.brand} size={40} />
      <Box sx={{ minWidth: 0 }}>
        <Text variant="body" weight="bold" as="span">
          {host.label}
        </Text>
        <Text variant="caption" as="p" color="secondary">
          {host.kind}
        </Text>
      </Box>
      {active && (
        <CheckCircleIcon
          sx={{ position: "absolute", top: 10, right: 10, fontSize: 20, color: "primary.main" }}
        />
      )}
    </Box>
  );
}

/**
 * Step 1 of the guided AI connect flow: the owner picks a single assistant
 * (Claude.ai, Claude Desktop, ChatGPT, Codex) from a card grid. Picking a card
 * advances straight to the next step — no separate "Próximo" button. Selection
 * is controlled (persisted by the onboarding flow) so a refresh resumes with the
 * same assistant highlighted.
 */
export function HostSelectStep({
  hosts,
  selectedId,
  onSelect,
}: {
  hosts: readonly AiHostGuide[];
  selectedId: string | null;
  onSelect: (hostId: string) => void;
}): React.JSX.Element {
  return (
    <Stack spacing={3} data-testid="ai-host-select">
      <Box>
        <Text variant="heading" size="sm" as="h2">
          Escolha o seu assistente
        </Text>
        <Text variant="caption" as="p" color="secondary">
          Selecione onde você usa a IA — o passo a passo é feito sob medida para ele.
        </Text>
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        }}
      >
        {hosts.map((host) => (
          <HostCard
            key={host.id}
            host={host}
            active={host.id === selectedId}
            onSelect={() => onSelect(host.id)}
          />
        ))}
      </Box>
    </Stack>
  );
}
