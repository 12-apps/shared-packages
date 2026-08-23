"use client";

import BoltOutlinedIcon from "@mui/icons-material/BoltOutlined";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";

import { Button } from "@12-apps/ui/form/Button";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import type { AiCapability } from "../guide";
import type { AiCapabilitiesCopy, AiLandingCopy } from "./copy";
import { AiCapabilities } from "./ai-capabilities";
import { FeatureBadge, type FeatureBadgeItem } from "./feature-badge";

/**
 * The ICONS for the landing's reassurance strip, keyed by the copy's own ids.
 *
 * The package keeps the icons and the host keeps the words: an icon is not
 * copy, and a pack that had to ship React elements could not be a plain data
 * file. An id the map does not know renders without an icon rather than
 * throwing — a host adding a fifth point should get its words on screen.
 */
const TRUST_ICONS: Readonly<Record<string, React.JSX.Element>> = {
  login: <LockOpenOutlinedIcon />,
  install: <BoltOutlinedIcon />,
  permissions: <VerifiedUserOutlinedIcon />,
  surface: <LanguageOutlinedIcon />,
};

function trustBadges(trust: AiLandingCopy["trust"]): FeatureBadgeItem[] {
  return trust.map((point) => ({
    icon: TRUST_ICONS[point.id],
    label: point.label,
    caption: point.caption,
  }));
}

/** The single-column marketing hero: eyebrow + headline + description + CTA. */
function Hero({
  onStart,
  copy,
}: {
  onStart: () => void;
  copy: AiLandingCopy;
}): React.JSX.Element {
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
        {copy.eyebrow}
      </Box>
      <Text variant="heading" size="xl" weight="bold" as="h1">
        {copy.titleLead}{" "}
        <Box component="span" sx={{ color: "primary.main" }}>
          {copy.titleEmphasis}
        </Box>{" "}
        {copy.titleTail}
      </Text>
      <Text variant="body" color="secondary" as="p">
        {copy.lede}
      </Text>
      <Box sx={{ pt: 1 }}>
        <Button onClick={onStart} data-testid="ai-landing-start">
          {copy.start}
        </Button>
      </Box>
    </Stack>
  );
}

/**
 * Homepage-style marketing landing for the AI integration (shown before the
 * owner starts): a hero, the permission reassurance, a trust/feature strip, and
 * the capability highlights. `onStart` begins the guided flow. `permissionModel`
 * and `capabilities` are REQUIRED host copy — the package ships no default
 * sentence (FUT-760).
 */
export function AiLanding({
  onStart,
  permissionModel,
  capabilities,
  copy,
  capabilitiesCopy,
}: {
  onStart: () => void;
  permissionModel: string;
  capabilities: readonly AiCapability[];
  copy: AiLandingCopy;
  capabilitiesCopy: AiCapabilitiesCopy;
}): React.JSX.Element {
  return (
    <Stack spacing={6} data-testid="ai-landing">
      <Hero onStart={onStart} copy={copy} />

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
          {trustBadges(copy.trust).map((f) => (
            <FeatureBadge key={f.label} icon={f.icon} label={f.label} caption={f.caption} />
          ))}
        </Box>
      </Box>

      <Box>
        <AiCapabilities capabilities={capabilities} copy={capabilitiesCopy} />
      </Box>
    </Stack>
  );
}
