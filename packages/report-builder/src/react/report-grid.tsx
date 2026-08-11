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

import type { DashboardBlockRender } from "./custom-reports-api";
import { BLOCK_FILL_BODY_SX, BLOCK_FILL_CARD_SX, blockCellSx } from "./lib/block-cell";
import type { DragReorder } from "./lib/drag-reorder";
import { PRINT_BLOCK_ATTR } from "./lib/print-export";
import { CONTAINER_RADIUS_PX, GRID_GAP_PX } from "./lib/report-surface";
import { BLOCK_TOOLS_REVEAL_SX, TOOL_ROW, ToolRowProvider } from "./lib/tool-cluster";
import { ReportRenderView } from "./report-render";

/**
 * The canvas: twelve columns at EVERY width — a phone gets the same layout
 * logic, not a stack that discards it; blocks widen instead (`responsiveSpan`).
 *
 * It is laid out with `flex-wrap` rather than `display: grid`. The original
 * reason was **no orphan row** (`visual-pass.md` §Layout): three half-width
 * blocks on a 12-column grid land 2-up then 1-up and leave a 548px hole at
 * 1440px, and a wrapped flex row could hand that leftover width back to the
 * blocks IN the row.
 *
 * IT NO LONGER DOES (FUT-755) — see `lib/block-cell`. Closing the row meant a
 * block alone on one took all of it, so a width the author picked was silently
 * overridden by how many neighbours it happened to have. The wrapping is kept
 * because the widths are computed from the grid's own column arithmetic either
 * way, and because `flex-wrap` is what lets `responsiveSpan` widen a block per
 * tier without a second layout mode.
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
 * One placed block: `span` columns on a desktop canvas, widened per tier below
 * it (`sm`/`md` = tablet, `xs` = phone) so narrow screens keep a real layout.
 *
 * The geometry — including why a block no longer GROWS past its span — is in
 * `lib/block-cell`, where it can be asserted on directly.
 */
export function ReportGridItem({
  span,
  height,
  children,
  dataTestId,
  dropProps,
}: {
  span: number;
  /** The block's height tier; omitted, the cell is as tall as its content. */
  height?: number;
  children: ReactNode;
  dataTestId?: string;
  /** Drop-target handlers when the grid is being rearranged (editor only). */
  dropProps?: ReturnType<DragReorder["targetProps"]>;
}): JSX.Element {
  return (
    <Box sx={blockCellSx(span, height)} data-testid={dataTestId} {...dropProps}>
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
  /**
   * Stretch the card, and the rendering in it, down the whole cell — set when
   * the block stores an `Altura` (FUT-755). Off, the frame is as tall as its
   * content: what it has always been, and what a block with no stored height
   * must go on being.
   */
  fill?: boolean;
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
 * ONE subtitle slot, two kinds of subtitle — and no block authors both.
 *
 * Where one somehow did, the WRITTEN disclosure wins: it is the half a reader
 * cannot reconstruct from the block's own settings, and the half that must
 * never be hidden. The generated sentence is a restatement of the query, which
 * the config panel shows in full anyway.
 */
function BlockSubtitle({
  specSentence,
  description,
  dataTestId,
}: {
  specSentence?: string;
  description?: string;
  dataTestId: string;
}): JSX.Element | null {
  if (description !== undefined && description !== "") {
    return <BlockDescription description={description} dataTestId={dataTestId} />;
  }
  if (specSentence !== undefined && specSentence !== "") {
    return <BlockSpecSentence sentence={specSentence} dataTestId={dataTestId} />;
  }
  return null;
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
  fill = false,
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
        ...(fill ? BLOCK_FILL_CARD_SX : {}),
      }}
      data-testid={dataTestId}
      {...{ [PRINT_BLOCK_ATTR]: "" }}
    >
      <Stack spacing={1.5} sx={fill ? BLOCK_FILL_CARD_SX : undefined}>
        <BlockHeaderRow title={title} actions={actions} />
        <BlockSubtitle
          specSentence={specSentence}
          description={description}
          dataTestId={dataTestId}
        />
        {/* The slot the height is FOR — without it the card grows and the
         * rendering stays at the top. Wrapped only when filling. */}
        {fill ? <Box sx={BLOCK_FILL_BODY_SX}>{children}</Box> : children}
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
  const fill = block.height !== undefined;
  return (
    <ReportRenderView render={block.render} dataTestId={`${dataTestId}-render`} asTable={asTable} fill={fill} />
  );
}
