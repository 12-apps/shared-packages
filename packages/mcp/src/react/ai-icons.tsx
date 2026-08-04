import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CategoryIcon from "@mui/icons-material/Category";
import HubIcon from "@mui/icons-material/Hub";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import QueryStatsIcon from "@mui/icons-material/QueryStats";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";

import { Box } from "@12-apps/ui/mui/Box";

import type { AiHostBrand } from "../guide";

/**
 * Brand accents for the host avatars. These are deliberately hardcoded (not
 * theme tokens): they are BRAND marks whose recognizability depends on the
 * vendor's own accent colour, so the "always semantic colours" rule doesn't
 * apply here. The glyphs are simple, original stand-ins — not the vendors'
 * proprietary logo artwork.
 */
const BRAND: Record<AiHostBrand, { bg: string; Icon: typeof AutoAwesomeIcon; label: string }> = {
  claude: { bg: "#D97757", Icon: AutoAwesomeIcon, label: "Claude (Anthropic)" },
  openai: { bg: "#10A37F", Icon: HubIcon, label: "OpenAI" },
};

/** A round brand chip: the vendor accent + a simple glyph. */
export function HostBrandAvatar({
  brand,
  size = 40,
}: {
  brand: AiHostBrand;
  size?: number;
}): React.JSX.Element {
  const { bg, Icon, label } = BRAND[brand];
  return (
    <Box
      aria-label={label}
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        bgcolor: bg,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon sx={{ fontSize: size * 0.55 }} />
    </Box>
  );
}

const CAPABILITY_ICON: Record<string, typeof AutoAwesomeIcon> = {
  orders: ReceiptLongIcon,
  inventory: Inventory2Icon,
  catalog: CategoryIcon,
  sales: QueryStatsIcon,
};

/** The icon for a capability card, by capability id (falls back to a sparkle). */
export function CapabilityIcon({
  id,
  fontSize = 24,
}: {
  id: string;
  fontSize?: number;
}): React.JSX.Element {
  const Icon = CAPABILITY_ICON[id] ?? AutoAwesomeIcon;
  return <Icon sx={{ fontSize }} />;
}
