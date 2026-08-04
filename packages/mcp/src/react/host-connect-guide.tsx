"use client";

import CheckIcon from "@mui/icons-material/Check";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useState } from "react";

import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { AiHostGuide } from "../guide";
import { HostBrandAvatar } from "./ai-icons";
import { McpEndpointUrl } from "./mcp-endpoint-url";

/**
 * The store's MCP endpoint URL with a blue "Copiar" button (the display-only
 * field defers the copy to this button). Controlled: `copied` flips the label to
 * "Copiado" and `onCopy` fires after the clipboard write — the wizard uses it to
 * unlock the "Próximo" button on the Copiar-URL step.
 */
export function EndpointCopyBlock({
  endpointUrl,
  copied,
  onCopy,
}: {
  endpointUrl: string;
  copied: boolean;
  onCopy: () => void;
}): React.JSX.Element {
  const handleClick = (): void => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(endpointUrl).catch(() => undefined);
    }
    onCopy();
  };

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        border: 1,
        borderColor: "primary.main",
        bgcolor: "action.hover",
      }}
    >
      <Text variant="caption" as="p" weight="bold">
        URL do servidor da sua loja
      </Text>
      <Text variant="caption" as="p" color="secondary">
        Copie esta URL e cole no seu assistente para conectá-lo à loja.
      </Text>
      <Box sx={{ mt: 1 }}>
        <McpEndpointUrl url={endpointUrl} copyable={false} />
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <Button onClick={handleClick} data-testid="ai-copy-endpoint">
          {copied ? (
            <CheckIcon sx={{ fontSize: 18, mr: 0.5 }} />
          ) : (
            <ContentCopyOutlinedIcon sx={{ fontSize: 18, mr: 0.5 }} />
          )}
          {copied ? "Copiado" : "Copiar URL"}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * A copyable multi-line message block (preserves line breaks). Used on the
 * Conectar step for the prompt the owner pastes into the assistant so it
 * identifies itself and calls a tool (which registers the connection).
 */
export function PromptCopyBlock({
  title,
  caption,
  message,
}: {
  title: string;
  caption: string;
  message: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleClick = (): void => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(message).catch(() => undefined);
    }
    setCopied(true);
  };

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 2,
        border: 1,
        borderColor: "primary.main",
        bgcolor: "action.hover",
      }}
    >
      <Text variant="caption" as="p" weight="bold">
        {title}
      </Text>
      <Text variant="caption" as="p" color="secondary">
        {caption}
      </Text>
      <Box
        sx={{
          mt: 1,
          p: 1.5,
          borderRadius: 1,
          border: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          whiteSpace: "pre-line",
        }}
      >
        <Text variant="body" size="sm" as="p">
          {message}
        </Text>
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <Button onClick={handleClick} data-testid="ai-copy-prompt">
          {copied ? (
            <CheckIcon sx={{ fontSize: 18, mr: 0.5 }} />
          ) : (
            <ContentCopyOutlinedIcon sx={{ fontSize: 18, mr: 0.5 }} />
          )}
          {copied ? "Copiado" : "Copiar mensagem"}
        </Button>
      </Box>
    </Box>
  );
}

/** The brand mark + "Conectar no <host>" header shared by the connect sub-steps. */
export function HostConnectHeader({ host }: { host: AiHostGuide }): React.JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <HostBrandAvatar brand={host.brand} size={36} />
      <Text variant="heading" size="sm" as="h3">
        Conectar no {host.label}
      </Text>
    </Stack>
  );
}

/**
 * The primary direct-link button to a host's connector settings (nothing when it
 * has none). `onOpen` fires after the link opens so the Configurar step can
 * unlock its "Próximo" only once the owner has actually gone to the connectors.
 */
export function HostOpenButton({
  host,
  onOpen,
}: {
  host: AiHostGuide;
  onOpen?: () => void;
}): React.JSX.Element | null {
  if (!host.link) return null;
  return (
    <Box>
      <Button
        onClick={() => {
          window.open(host.link!.url, "_blank", "noopener,noreferrer");
          onOpen?.();
        }}
        data-testid={`ai-host-link-${host.id}`}
      >
        {host.link.label}
        <OpenInNewIcon sx={{ fontSize: 16, ml: 0.5 }} />
      </Button>
    </Box>
  );
}

/** A "Para mais informações" reference to the host's official connector docs. */
export function HostDocsLink({ host }: { host: AiHostGuide }): React.JSX.Element | null {
  if (!host.docs) return null;
  return (
    <Text variant="caption" as="p" color="secondary">
      Para mais informações, consulte a{" "}
      <Box
        component="a"
        href={host.docs.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`ai-host-docs-${host.id}`}
        sx={{ color: "primary.main", textDecoration: "underline" }}
      >
        {host.docs.label}
      </Box>
      .
    </Text>
  );
}

/**
 * A numbered slice of a host's connect steps. `start` keeps the numbering
 * continuous when the steps are split across wizard stages (e.g. the Conectar
 * stage continues at 4 after Configurar showed 1–3).
 */
export function HostStepList({
  steps,
  start = 1,
}: {
  steps: readonly string[];
  start?: number;
}): React.JSX.Element {
  return (
    <Box component="ol" start={start} sx={{ m: 0, pl: 3 }}>
      {steps.map((step, index) => (
        <Box component="li" key={index} sx={{ mb: 1 }}>
          <Text variant="body" as="span">
            {step}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
