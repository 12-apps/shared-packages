"use client";

import { Text } from "../../typography/Text";
import { Box } from "../../../mui/Box";

/* ── Header row ──────────────────────────────────────────────────────────── */

/**
 * The grid's own header row: the page title on the left, the primary page
 * actions on the right.
 *
 * `title` and `headerActions` were DECLARED on `DataViewsGridProps` and
 * `DataViewsTableBaseProps` but never destructured or forwarded — dead props
 * whose types lied to every caller that set them. Wired here rather than
 * deleted: a table that carries its own title keeps the title, the scope tabs
 * and the toolbar as one block, instead of the page having to space them.
 *
 * Renders NOTHING when neither is supplied, so no existing table gains a row.
 */
export function GridHeaderRow({
  title,
  headerActions,
  testIdPrefix,
}: {
  title?: string;
  headerActions?: React.ReactNode;
  testIdPrefix: string;
}): React.JSX.Element | null {
  if (!title && !headerActions) return null;
  return (
    <Box
      data-testid={`${testIdPrefix}-header`}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        flexWrap: "wrap",
        pb: 1.5,
      }}
    >
      {title ? (
        <Text variant="heading" size="lg" as="h2">
          {title}
        </Text>
      ) : (
        <Box />
      )}
      {headerActions && <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>{headerActions}</Box>}
    </Box>
  );
}
