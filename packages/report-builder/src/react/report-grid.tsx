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
import { useMeasuredWidth } from "@12-apps/ui/utility/Overflow";

import { REPORT_GRID_COLUMNS, responsiveSpan } from "../layout";
import type { DashboardBlockRender } from "./custom-reports-api";
import type { DragReorder } from "./lib/drag-reorder";
import { PRINT_BLOCK_ATTR } from "./lib/print-export";
import { CONTAINER_RADIUS_PX, GRID_GAP_PX } from "./lib/report-surface";
import { BLOCK_TOOLS_REVEAL_SX, TOOL_ROW, ToolRowProvider } from "./lib/tool-cluster";
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
 * The spec sentence is ONE DISCREET LINE, not a panel (FUT-755).
 *
 * It used to be a full-width tinted box that wrapped onto a second line —
 * `Text variant="code"` brings a tint, a border, padding and a radius of its
 * own, and this restated the box bigger still. That put the machine's summary
 * of the query in a container louder than the figures the block exists to
 * show. `prototype.html`'s `.block-spec` is a caption: mono, muted, `nowrap`,
 * `overflow:hidden`, `text-overflow:ellipsis` — one line, truncated, directly
 * under the title. So the box is switched OFF here (the component's tint,
 * border, padding and radius all come back to nothing) and only the mono face
 * survives.
 *
 * Inline rather than `sx` because it has to beat the component's own emotion
 * class, and because a style this component sets on itself is the one thing
 * that must not be overridable by a host's theme.
 */
const SPEC_SENTENCE_STYLE: CSSProperties = {
  display: "block",
  margin: 0,
  padding: "0px",
  // `borderWidth: 0` rather than `border: none` — it overrides exactly the one
  // longhand the component sets and leaves the rest alone, and unlike the
  // shorthand it survives jsdom, so the absence of the box is testable.
  borderWidth: 0,
  borderRadius: "0px",
  backgroundColor: "transparent",
  lineHeight: 1.5,
  // The truncation itself. `maxWidth` is what gives the ellipsis something to
  // measure against — a `nowrap` flex child is otherwise sized by its content.
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "100%",
};

/** Authored prose wraps, and carries no box either. */
const BLOCK_DESCRIPTION_STYLE: CSSProperties = { display: "block", margin: 0 };

interface ReportBlockFrameProps {
  title: ReactNode;
  /**
   * The MACHINE's one-line summary of what this block asks for — "soma de
   * receita em pedidos por forma de pagamento, onde status é PAID" — as the
   * server's `specSentence` writes it.
   *
   * Mono, because that is how a reader tells generated text from written text
   * throughout the prototype. Truncated to one line, because it is a restatement
   * of the query rather than something to read: the full sentence stays
   * available in the element's `title`, and the block's own configuration is
   * where it is actually edited.
   */
  specSentence?: string;
  /**
   * PROSE somebody wrote, under the title (FUT-454) — a built-in report's
   * statement of what its figures exclude and when they are withheld.
   *
   * It wraps in full and is never truncated: this is the screen where the
   * numbers it qualifies are being read, and half a disclosure is worse than
   * none. It is not set in the mono face for the same reason the sentence
   * above is — the two must not look like the same kind of text.
   *
   * The two were ONE prop until FUT-755, which is how a change aimed at the
   * generated sentence nearly cut a disclosure off mid-word.
   */
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  dataTestId: string;
  /** Highlight the frame as the current drop slot (editor drag-and-drop). */
  active?: boolean;
}

/**
 * The machine-written half of a block's header: mono, one line, ellipsis.
 *
 * The `title` attribute is not decoration — truncation HIDES text, so the full
 * sentence has to stay recoverable somewhere, and the element that hid it is
 * the only place a reader would think to look.
 */
function BlockSpecSentence({
  sentence,
  dataTestId,
}: {
  sentence: string;
  dataTestId: string;
}): JSX.Element {
  return (
    <Text
      variant="code"
      size="sm"
      color="secondary"
      as="p"
      style={SPEC_SENTENCE_STYLE}
      title={sentence}
      data-testid={`${dataTestId}-description`}
    >
      {sentence}
    </Text>
  );
}

/** The written half: whole sentences, in the reading face, wrapping in full. */
function BlockDescription({
  description,
  dataTestId,
}: {
  description: string;
  dataTestId: string;
}): JSX.Element {
  return (
    <Text
      size="sm"
      color="secondary"
      as="p"
      style={BLOCK_DESCRIPTION_STYLE}
      data-testid={`${dataTestId}-description`}
    >
      {description}
    </Text>
  );
}

/**
 * THE CHROME NEVER LEAVES THIS ROW (FUT-755, gap 18).
 *
 * It used to be `flexWrap: "wrap"`, so a block too narrow for title + chrome
 * put the chrome on a second line, left-aligned under the title. That was a
 * real trade, not an oversight: the row it replaced simply OVERFLOWED at 390px
 * and pushed ⋮ off-screen, and ⋮ was the only route to Editar — a report could
 * not be edited on a phone at all. Wrapping was the cheap way to stop losing a
 * control.
 *
 * Overflowing into the ⋮ menu answers the same problem without the trade.
 * Nothing is pushed off-screen, because a tool that does not fit MOVES into
 * the menu as a real labelled item running the same handler; and nothing
 * steals width from the rendering below, because the row can no longer grow a
 * second line. So it is `nowrap` now, and the cluster is pinned right at every
 * width.
 *
 * The row is also the thing with a WIDTH, so it is what measures itself: the
 * cluster inside `actions` is an opaque node from here and reads the answer
 * out of `ToolRowProvider`. The deciding lives in `lib/tool-cluster`.
 */
function BlockHeaderRow({
  title,
  actions,
}: {
  title: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  return (
    <Stack
      ref={ref}
      direction="row"
      spacing={1}
      sx={{
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "nowrap",
        minHeight: 32,
      }}
    >
      <ToolRowProvider width={width}>
        {/* The title takes the room the tools do not — down to a floor, which
          * is the SAME number the cluster prices it at. A row whose CSS lets
          * the title take more than the arithmetic assumed sheds nothing and
          * overflows anyway. */}
        <Box sx={{ flex: 1, minWidth: `${TOOL_ROW.title}px` }}>
          {typeof title === "string" ? (
            <Text variant="heading" size="lg" weight="semibold" as="h2">
              {title}
            </Text>
          ) : (
            title
          )}
        </Box>
        {actions}
      </ToolRowProvider>
    </Stack>
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
  specSentence,
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
        // The card is what hides and reveals its own tool cluster, because CSS
        // has no ancestor selector and hovering the BLOCK is what should show
        // the tools. Keyboard and touch are handled with it — see the constant.
        ...BLOCK_TOOLS_REVEAL_SX,
        ...(active ? { outline: "2px dashed", outlineColor: "primary.main" } : {}),
      }}
      data-testid={dataTestId}
      {...{ [PRINT_BLOCK_ATTR]: "" }}
    >
      <Stack spacing={1.5}>
        <BlockHeaderRow title={title} actions={actions} />
        {/* ONE subtitle slot, two kinds of subtitle — and no block authors
         * both. Where one somehow did, the written disclosure would win: it is
         * the half a reader cannot reconstruct from the block's own settings,
         * and it is the half that must never be hidden. */}
        {description !== undefined && description !== "" ? (
          <BlockDescription description={description} dataTestId={dataTestId} />
        ) : specSentence !== undefined && specSentence !== "" ? (
          <BlockSpecSentence sentence={specSentence} dataTestId={dataTestId} />
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
  asTable = false,
}: {
  block: DashboardBlockRender;
  dataTestId: string;
  /** Chart blocks only: draw the rendering as its table (the header toggle). */
  asTable?: boolean;
}): JSX.Element {
  if (block.status === "error") {
    return (
      <Alert severity="error" data-testid={`${dataTestId}-error`}>
        {block.error}
      </Alert>
    );
  }
  return (
    <ReportRenderView
      render={block.render}
      dataTestId={`${dataTestId}-render`}
      asTable={asTable}
    />
  );
}
