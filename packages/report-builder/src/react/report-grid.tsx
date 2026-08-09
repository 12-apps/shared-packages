/**
 * The report canvas (FUT-391) — ONE grid, used by the viewer and the editor.
 *
 * This is the file that makes "edit shows exactly what view shows" a structural
 * guarantee rather than a promise: both modes lay their blocks out with
 * `ReportGrid`/`ReportGridItem` and render their contents with the same
 * `ReportRenderView`. Edit mode only adds chrome INSIDE the frame (a handle, a
 * pen, a trash); it never re-implements the layout.
 */
import type { CSSProperties, JSX, ReactNode } from "react";

import { Alert } from "@12-apps/ui/data-display/Alert";
import { Card } from "@12-apps/ui/layout/Card";
import { Box } from "@12-apps/ui/mui/Box";
import { Stack } from "@12-apps/ui/mui/Stack";
import { Text } from "@12-apps/ui/typography/Text";

import { REPORT_GRID_COLUMNS, responsiveSpan } from "../layout";
import type { DashboardBlockRender } from "./custom-reports-api";
import type { DragReorder } from "./lib/drag-reorder";
import { PRINT_BLOCK_ATTR } from "./lib/print-export";
import { CONTAINER_RADIUS_PX, CONTROL_RADIUS_PX, GRID_GAP_PX } from "./lib/report-surface";
import { ReportRenderView } from "./report-render";

/**
 * The canvas: twelve columns at EVERY width — a phone gets the same layout
 * logic, not a stack that discards it; blocks widen instead (`responsiveSpan`).
 *
 * It is laid out with `flex-wrap`, not `grid`, for one reason: **no orphan
 * row** (`visual-pass.md` §Layout). Three half-width blocks on a 12-column grid
 * land 2-up then 1-up and leave a 548px hole at 1440px, which the eye reads as
 * a bug. A wrapped flex row hands its leftover width back to the blocks that
 * are IN that row, in proportion to their spans, so the last row always closes.
 * Every full row still measures exactly what the grid measured — the basis
 * below is the grid's own column arithmetic — so nothing else moves.
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
        display: "flex",
        flexWrap: "wrap",
        gap: `${GRID_GAP_PX}px`,
        // A block is as tall as its CONTENT (`prototype.html`'s canvas is
        // `align-items:start`). Stretched, a three-row table beside a chart was
        // padded out to the chart's height and carried ~180px of empty white
        // inside its own border. That is "dead space" — sixth in
        // `visual-pass.md`'s ranking of what makes these screens read as cheap
        // — and it is worse than a ragged row, because a block with a hole in
        // it looks like one that failed to load the rest of itself.
        alignItems: "flex-start",
      }}
      data-testid={dataTestId}
    >
      {children}
    </Box>
  );
}

/**
 * The width a `span`-column block starts at: identical to `grid-column: span N`
 * on a 12-column grid with the same gap. The half pixel is slack — it can only
 * ever make a row fit, never wrap early, and `flex-grow` hands it straight back.
 */
function spanBasis(span: number): string {
  const gutters = (REPORT_GRID_COLUMNS - 1) * GRID_GAP_PX;
  return `calc(${span} * (100% - ${gutters}px) / ${REPORT_GRID_COLUMNS} + ${(span - 1) * GRID_GAP_PX}px - 0.5px)`;
}

/**
 * One placed block: `span` columns on a desktop canvas, widened per tier below
 * it (`sm`/`md` = tablet, `xs` = phone) so narrow screens keep a real layout.
 *
 * `flexGrow` is the span rather than `1`: when a row has width to give away,
 * a block that asked for six columns takes twice as much of it as one that
 * asked for three, so filling the row cannot reorder the author's emphasis.
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
  const phone = responsiveSpan(span, "phone");
  const tablet = responsiveSpan(span, "tablet");
  const desktop = responsiveSpan(span, "desktop");
  return (
    <Box
      sx={{
        flexGrow: { xs: phone, sm: tablet, lg: desktop },
        flexShrink: 1,
        flexBasis: { xs: spanBasis(phone), sm: spanBasis(tablet), lg: spanBasis(desktop) },
        minWidth: 0,
        maxWidth: "100%",
      }}
      data-testid={dataTestId}
      {...dropProps}
    >
      {children}
    </Box>
  );
}

/**
 * The block's spec line reads as a PANEL, not as an inline code chip.
 *
 * `typography/Code` and `Text variant="code"` both size themselves for a
 * fragment quoted inside a sentence — 2px of vertical padding and a 2px radius.
 * This is a whole sentence, so it gets a block's padding and the control radius
 * the rest of the screen uses. The mono face and the tint come from the
 * component; only the box is restated here.
 */
const SPEC_SENTENCE_STYLE: CSSProperties = {
  display: "block",
  margin: 0,
  padding: "8px 10px",
  borderRadius: `${CONTROL_RADIUS_PX}px`,
  lineHeight: 1.5,
};

interface ReportBlockFrameProps {
  title: ReactNode;
  /**
   * The block's own caveats, under its title (FUT-454). A built-in report's
   * description carries what its figures exclude and when they are withheld;
   * rendering it only on the single-report deep-link page — which the canvas
   * does not link to — meant those statements were never actually made to the
   * person reading the numbers.
   *
   * It renders in the MONO face, because on the authored canvas it is the
   * block's generated spec sentence ("soma de receita em pedidos por forma de
   * pagamento, onde status é PAID") rather than prose someone wrote — and
   * machine-generated text is set in the mono face throughout the prototype,
   * which is how a reader tells the two apart at a glance.
   */
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  dataTestId: string;
  /** Highlight the frame as the current drop slot (editor drag-and-drop). */
  active?: boolean;
}

/** The machine-written half of a block's header, in the mono face. */
function BlockSpecSentence({
  description,
  dataTestId,
}: {
  description: string;
  dataTestId: string;
}): JSX.Element {
  return (
    <Text
      variant="code"
      size="sm"
      color="secondary"
      as="p"
      style={SPEC_SENTENCE_STYLE}
      data-testid={`${dataTestId}-description`}
    >
      {description}
    </Text>
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
}: ReportBlockFrameProps): JSX.Element {
  return (
    <Card
      variant="outlined"
      sx={{
        p: 2,
        // Explicit, because the canvas under it is tinted: the card is the
        // SURFACE and the page is the canvas, which is the pair that gives the
        // block depth without a shadow.
        bgcolor: "background.paper",
        boxShadow: "none",
        borderRadius: `${CONTAINER_RADIUS_PX}px`,
        ...(active ? { outline: "2px dashed", outlineColor: "primary.main" } : {}),
      }}
      data-testid={dataTestId}
      {...{ [PRINT_BLOCK_ATTR]: "" }}
    >
      <Stack spacing={1.5}>
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
            <Text variant="heading" size="lg" weight="semibold" as="h2">
              {title}
            </Text>
          ) : (
            title
          )}
          {actions}
        </Stack>
        {description ? (
          <BlockSpecSentence description={description} dataTestId={dataTestId} />
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
