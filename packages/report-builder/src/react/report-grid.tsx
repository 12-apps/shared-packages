/**
 * The report canvas (FUT-391) — ONE grid, used by the viewer and the editor.
 *
 * This is the file that makes "edit shows exactly what view shows" a structural
 * guarantee rather than a promise: both modes lay their blocks out with
 * `ReportGrid`/`ReportGridItem` and render their contents with the same
 * `ReportRenderView`. Edit mode only adds chrome INSIDE the frame (a handle, a
 * pen, a trash); it never re-implements the layout.
 */
import type { JSX, ReactNode } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Card } from "@12-apps/ui/layout/Card";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { REPORT_GRID_COLUMNS, responsiveSpan } from "../layout";
import type { DashboardBlockRender } from "./custom-reports-api";
import type { DragReorder } from "./lib/drag-reorder";
import { PRINT_BLOCK_ATTR } from "./lib/print-export";
import { ReportRenderView } from "./report-render";

/**
 * The 12-column canvas. It stays twelve columns at EVERY width — a phone gets
 * the same layout logic, not a stack that discards it; blocks widen instead
 * (see `responsiveSpan`).
 */
export function ReportGrid({
  children,
  dataTestId,
}: {
  children: ReactNode;
  dataTestId: string;
}): JSX.Element {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: `repeat(${REPORT_GRID_COLUMNS}, minmax(0, 1fr))`,
        alignItems: "stretch",
      }}
      data-testid={dataTestId}
    >
      {children}
    </Box>
  );
}

/**
 * One placed block: `span` columns on a desktop canvas, widened per tier below
 * it (`sm`/`md` = tablet, `xs` = phone) so narrow screens keep a real layout.
 */
export function ReportGridItem({
  span,
  children,
  dataTestId,
  dropProps,
}: {
  span: number;
  children: ReactNode;
  dataTestId?: string;
  /** Drop-target handlers when the grid is being rearranged (editor only). */
  dropProps?: ReturnType<DragReorder["targetProps"]>;
}): JSX.Element {
  return (
    <Box
      sx={{
        gridColumn: {
          xs: `span ${responsiveSpan(span, "phone")}`,
          sm: `span ${responsiveSpan(span, "tablet")}`,
          lg: `span ${responsiveSpan(span, "desktop")}`,
        },
        minWidth: 0,
      }}
      data-testid={dataTestId}
      {...dropProps}
    >
      {children}
    </Box>
  );
}

/**
 * A block's frame: the card, its title row and an `actions` slot. The viewer
 * fills that slot with an export button, the editor with its edit chrome —
 * the frame itself is identical in both, which is what keeps the two modes
 * visually honest.
 */
export function ReportBlockFrame({
  title,
  description,
  actions,
  children,
  dataTestId,
  active = false,
}: {
  title: ReactNode;
  /**
   * The block's own caveats, under its title (FUT-454). A built-in report's
   * description carries what its figures exclude and when they are withheld;
   * rendering it only on the single-report deep-link page — which the canvas
   * does not link to — meant those statements were never actually made to the
   * person reading the numbers.
   */
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  dataTestId: string;
  /** Highlight the frame as the current drop slot (editor drag-and-drop). */
  active?: boolean;
}): JSX.Element {
  return (
    <Card
      variant="outlined"
      sx={{
        p: 2,
        height: "100%",
        ...(active ? { outline: "2px dashed", outlineColor: "primary.main" } : {}),
      }}
      data-testid={dataTestId}
      {...{ [PRINT_BLOCK_ATTR]: "" }}
    >
      <Stack spacing={1.5} sx={{ height: "100%" }}>
        {/* Wraps rather than squeezes: a 2-column block's chrome moves to a
         * second line instead of stealing width from the rendering below. */}
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            rowGap: 0.5,
            minHeight: 32,
          }}
        >
          {typeof title === "string" ? (
            <Text variant="heading" size="sm" as="h2">
              {title}
            </Text>
          ) : (
            title
          )}
          {actions}
        </Stack>
        {description ? (
          <Text variant="body" size="sm" color="secondary" data-testid={`${dataTestId}-description`}>
            {description}
          </Text>
        ) : null}
        {children}
      </Stack>
    </Card>
  );
}

/**
 * A rendered block's body: its result, or the compiler's actionable message
 * when THIS block's stored spec no longer compiles. A broken block never takes
 * the report down with it — the rest of the canvas still renders.
 */
export function ReportBlockBody({
  block,
  dataTestId,
}: {
  block: DashboardBlockRender;
  dataTestId: string;
}): JSX.Element {
  if (block.status === "error") {
    return (
      <Alert severity="error" data-testid={`${dataTestId}-error`}>
        {block.error}
      </Alert>
    );
  }
  return <ReportRenderView render={block.render} dataTestId={`${dataTestId}-render`} />;
}
