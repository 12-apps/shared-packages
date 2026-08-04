import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

/** One entry of a landing's trust/feature strip. */
export interface FeatureBadgeItem {
  icon: React.ReactNode;
  label: string;
  caption: string;
}

/**
 * One item of an onboarding landing's trust/feature strip: a paper icon tile
 * (primary-coloured glyph) with a two-line label + caption.
 */
export function FeatureBadge({ icon, label, caption }: FeatureBadgeItem): React.JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "background.paper",
          color: "primary.main",
          border: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box>
        <Text variant="body" size="sm" weight="bold" as="p">
          {label}
        </Text>
        <Text variant="caption" color="secondary" as="p">
          {caption}
        </Text>
      </Box>
    </Stack>
  );
}
