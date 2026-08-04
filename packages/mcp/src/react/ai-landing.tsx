"use client";

import BoltOutlinedIcon from "@mui/icons-material/BoltOutlined";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";

import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { AI_CAPABILITIES, AI_PERMISSION_MODEL, type AiCapability } from "../guide";
import { AiCapabilities } from "./ai-capabilities";
import { FeatureBadge, type FeatureBadgeItem } from "./feature-badge";

const FEATURES: FeatureBadgeItem[] = [
  { icon: <LockOpenOutlinedIcon />, label: "Usa o seu próprio login", caption: "Sem chaves ou credenciais extras" },
  { icon: <BoltOutlinedIcon />, label: "Sem instalar nada", caption: "Conecta em poucos minutos" },
  { icon: <VerifiedUserOutlinedIcon />, label: "Só o que você pode", caption: "As suas permissões, nada além" },
  { icon: <LanguageOutlinedIcon />, label: "Navegador ou app", caption: "Claude, ChatGPT, Codex" },
];

/** The single-column marketing hero: eyebrow + headline + description + CTA. */
function Hero({ onStart }: { onStart: () => void }): React.JSX.Element {
  return (
    <Stack spacing={2.5} sx={{ maxWidth: 680 }}>
      <Box
        sx={{
          color: "primary.main",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}
      >
        Integração com IA
      </Box>
      <Text variant="heading" size="xl" weight="bold" as="h1">
        Conecte{" "}
        <Box component="span" sx={{ color: "primary.main" }}>
          assistentes de IA
        </Box>{" "}
        à sua loja
      </Text>
      <Text variant="body" color="secondary" as="p">
        Deixe o Claude, o ChatGPT e outros assistentes responderem sobre o seu cardápio, estoque e
        pedidos — e executarem ações por você, direto na conversa. Com segurança e sem instalar
        nada.
      </Text>
      <Box sx={{ pt: 1 }}>
        <Button onClick={onStart} data-testid="ai-landing-start">
          Ver como conectar
        </Button>
      </Box>
    </Stack>
  );
}

/**
 * Homepage-style marketing landing for the AI integration (shown before the
 * owner starts): a hero, the permission reassurance, a trust/feature strip, and
 * the capability highlights. `onStart` begins the guided flow. `permissionModel`
 * and `capabilities` default to the shared copy; apps can override.
 */
export function AiLanding({
  onStart,
  permissionModel = AI_PERMISSION_MODEL,
  capabilities = AI_CAPABILITIES,
}: {
  onStart: () => void;
  permissionModel?: string;
  capabilities?: readonly AiCapability[];
}): React.JSX.Element {
  return (
    <Stack spacing={6} data-testid="ai-landing">
      <Hero onStart={onStart} />

      <Stack
        direction="row"
        spacing={1.5}
        alignItems="flex-start"
        data-testid="ai-permission-callout"
        sx={{
          p: 2,
          borderRadius: 2,
          bgcolor: "action.hover",
          border: 1,
          borderColor: "divider",
        }}
      >
        <VerifiedUserOutlinedIcon sx={{ color: "success.main", mt: 0.25 }} />
        <Text variant="body" as="p">
          {permissionModel}
        </Text>
      </Stack>

      <Box
        sx={{
          p: { xs: 2.5, md: 3 },
          borderRadius: 3,
          bgcolor: "action.hover",
          border: 1,
          borderColor: "divider",
        }}
      >
        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" },
          }}
        >
          {FEATURES.map((f) => (
            <FeatureBadge key={f.label} icon={f.icon} label={f.label} caption={f.caption} />
          ))}
        </Box>
      </Box>

      <Box>
        <AiCapabilities capabilities={capabilities} />
      </Box>
    </Stack>
  );
}
