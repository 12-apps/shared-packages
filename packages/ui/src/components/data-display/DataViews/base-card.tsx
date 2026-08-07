"use client";

import { type ReactNode } from "react";

import { useTheme, type CSSObject } from "@mui/material/styles";

/** See the note on `CardSx` in `card-surface` — these fragments get merged. */
type CardSx = CSSObject | Record<string, unknown>;

import { Checkbox } from "../../form/Checkbox";
import { Card } from "../../layout/Card";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import { DragHandle, useDragItem } from "./data-views-drag";
import {
  CARD_RADIUS,
  cardSurfaceStyles,
  isActionable,
  isSelectable,
  slotTestIds,
  type CardSurfaceProps,
} from "./card-surface";
import { CARD_ASPECT_RATIOS, type CardAspectRatio } from "./data-views-types";

export interface BaseCardProps extends CardSurfaceProps {
  /** Extra body content below the caption (chips, meta). Optional. */
  children?: ReactNode;
  /** Tile proportion. Defaults to "4:3". */
  aspectRatio?: CardAspectRatio;
  /**
   * Size multiplier from the zoom slider (1 = base).
   *
   * Applied as `zoom`, so the whole card grows together — padding, typography,
   * the checkbox, the menu and the media alike — in step with its width, which
   * the grid sizes to base × scale. A card at scale 2 renders at ~twice the
   * size, its proportion preserved by `aspectRatio`. Default 1.
   */
  scale?: number;
  /** Display-image node (e.g. an `<img>` / thumbnail) filling the media region. */
  image?: ReactNode;
  /** Shown centered in the media region when there is no `image` (icon/initial). */
  imageFallback?: ReactNode;
  /** First-class title, rendered in the caption. */
  title?: ReactNode;
  /** Secondary caption line under the title. */
  subtitle?: ReactNode;
  /** The 3-dots menu (or any action node) pinned to the top-right corner. */
  menu?: ReactNode;
  /** Toggle this card's selection. Omit to hide the checkbox (non-selectable). */
  onToggleSelect?: () => void;
  /**
   * This card's id for drag purposes.
   *
   * Draggable ONLY inside a {@link DragContainerProvider} — see
   * `data-views-drag`. On the board that is how a card moves between columns;
   * in a grade it is how the operator reorders. Outside a container this is
   * inert and no grip appears.
   */
  dragId?: string | number;
  checkboxTestId?: string;
}

/**
 * The outlined-tile style: fixed ratio, scaled padding, selected/dimmed states.
 *
 * See the note on the row: `zoom` scales EVERY length in the subtree, including
 * the MUI internals (checkbox, chip, icon button) that no prop of ours reaches.
 * The grid still sizes the track to BASE_CARD_WIDTH x scale, so the tile fills
 * its track physically and lays its contents out in the unscaled box behind it
 * — which is what "the whole card grows together" was always meant to mean.
 */
function cardSx(opts: {
  aspectRatio: CardAspectRatio;
  pad: number;
  scale: number;
  interactive: boolean;
  draggable: boolean;
}): CardSx {
  const { aspectRatio, pad, scale, interactive, draggable } = opts;
  return {
    position: "relative",
    zoom: scale,
    aspectRatio: String(CARD_ASPECT_RATIOS[aspectRatio]),
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    p: pad,
    cursor: draggable ? "grab" : interactive ? "pointer" : undefined,
    ...(draggable ? { touchAction: "none", "&:active": { cursor: "grabbing" } } : {}),
  };
}

/**
 * How far the first block in flow must start below the tile's top edge to clear
 * the absolute overlays: their 4px inset plus the checkbox's 38px hit area (20px
 * glyph in MUI's 9px padding), which is the taller of the two corners.
 */
const OVERLAY_BAND_PX = 42;

/**
 * The top margin each stacked slot needs, in MUI spacing units.
 *
 * The overlays are absolute, so they cost the flow nothing — over MEDIA that is
 * the whole point (a checkbox on a thumbnail reads as a checkbox on a
 * thumbnail). Over TEXT it is a collision: a title-only tile started its first
 * line at the padding edge, directly under the checkbox, and rendered
 * `Selecionada` with the box sitting on the `Se`. So when nothing pictorial is
 * there to absorb them, whichever block comes first clears the band instead.
 */
function contentGaps(opts: {
  hasMedia: boolean;
  hasBody: boolean;
  overlays: boolean;
  pad: number;
}): { body: number; caption: number } {
  const { hasMedia, hasBody, overlays, pad } = opts;
  const gap = pad * 0.5;
  const clear = !hasMedia && overlays ? Math.max(0, OVERLAY_BAND_PX / 8 - pad) : 0;
  return { body: hasMedia ? gap : clear, caption: hasMedia || hasBody ? gap : clear };
}

/** The top-corner overlays: the select checkbox (left) and the menu slot (right). */
function CardOverlays({
  selected,
  onToggleSelect,
  checkboxTestId,
  menu,
}: Pick<BaseCardProps, "selected" | "onToggleSelect" | "checkboxTestId" | "menu">): React.JSX.Element {
  return (
    <>
      {onToggleSelect && (
        <Box sx={{ position: "absolute", top: 4, left: 4, zIndex: 2 }}>
          <Checkbox
            checked={selected}
            onChange={() => onToggleSelect()}
            // Selecting must never trigger the card's own click (open/edit).
            onClick={(event) => event.stopPropagation()}
            size="small"
            data-testid={checkboxTestId}
            aria-label="Selecionar"
          />
        </Box>
      )}
      {menu && (
        <Box
          sx={{ position: "absolute", top: 4, right: 4, zIndex: 2 }}
          // Acting on the menu must never trigger the card's own click.
          onClick={(event) => event.stopPropagation()}
        >
          {menu}
        </Box>
      )}
    </>
  );
}

/**
 * Media region: fills the tile above the caption; centers `imageFallback` when
 * there is no image so title-only entities still fill the ratio box and mixed
 * grids stay aligned.
 */
function CardMedia({ image, imageFallback }: Pick<BaseCardProps, "image" | "imageFallback">): React.JSX.Element {
  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: 1,
        "& img": { width: "100%", height: "100%", objectFit: "cover" },
      }}
    >
      {image ?? imageFallback}
    </Box>
  );
}

/** The body slot (chips/meta); fills remaining space when there is no media. */
function CardBodyContent({
  children,
  fill,
  topGap,
}: {
  children: ReactNode;
  fill: boolean;
  topGap: number;
}): React.JSX.Element {
  return (
    <Box
      sx={{
        flex: fill ? 1 : "none",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.75,
        mt: topGap,
        overflow: "hidden",
      }}
    >
      {children}
    </Box>
  );
}

/** The title/subtitle caption. */
function CardCaption({
  title,
  subtitle,
  topGap,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  topGap: number;
}): React.JSX.Element {
  return (
    <Box sx={{ mt: topGap, minWidth: 0 }}>
      {title != null && (
        <Text
          variant="heading"
          size="sm"
          weight="bold"
          as="p"
          style={{
            lineHeight: 1.15,
            fontSize: "0.95rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </Text>
      )}
      {subtitle != null && (
        <Text variant="caption" size="xs" color="secondary" as="p">
          {subtitle}
        </Text>
      )}
    </Box>
  );
}

/** The stacked media / body / caption slots inside the tile (below the overlays). */
function CardContents({
  children,
  image,
  imageFallback,
  title,
  subtitle,
  overlays,
  pad,
}: Pick<BaseCardProps, "children" | "image" | "imageFallback" | "title" | "subtitle"> & {
  overlays: boolean;
  pad: number;
}): React.JSX.Element {
  const hasMedia = image != null || imageFallback != null;
  const hasBody = children != null;
  const hasCaption = title != null || subtitle != null;
  const top = contentGaps({ hasMedia, hasBody, overlays, pad });
  return (
    <>
      {hasMedia && <CardMedia image={image} imageFallback={imageFallback} />}
      {hasBody && (
        <CardBodyContent fill={!hasMedia} topGap={top.body}>
          {children}
        </CardBodyContent>
      )}
      {hasCaption && <CardCaption title={title} subtitle={subtitle} topGap={top.caption} />}
    </>
  );
}

/**
 * Reusable selectable card shell for the DataViews "Grade" (cards) layout, and
 * the ONLY card component that lives in `@12-apps/ui` — every domain "kind card"
 * (product, mesa, role, …) lives in the app and composes this envelope. See the
 * per-slot helpers above; this shell just assembles them within a fixed-ratio
 * tile. Reads no context, so it renders standalone as well as inside the grid.
 */
/**
 * Everything the tile derives from its props before it can render — pulled out
 * so `BaseCard` itself stays inside the complexity budget.
 */
function useCardShell(props: BaseCardProps) {
  const actionable = isActionable(props.state);
  return {
    selectable: isSelectable(props),
    actionable,
    theme: useTheme(),
    slot: slotTestIds(props.testId),
    scale: props.scale ?? 1,
    // The card's own veto over the container's decision — see `CardSurfaceProps`.
    drag: useDragItem(props.draggable === false || !actionable ? undefined : props.dragId),
  };
}

export function BaseCard(props: BaseCardProps): React.JSX.Element {
  const { aspectRatio = "4:3", selected = false } = props;
  const { menu, onToggleSelect, onClick } = props;
  const { selectable, actionable, theme, slot, scale, drag } = useCardShell(props);
  const dataTestId = props.testId;
  const checkboxTestId = slot("checkbox");
  const pad = 1.5;

  return (
    <Card
      variant="outlined"
      onClick={onClick}
      dataTestId={dataTestId}
      className={props.className}
      aria-label={props["aria-label"]}
      aria-disabled={actionable ? undefined : true}
      {...drag.itemProps}
      // A PLAIN OBJECT, not a function. `Card` merges by spreading
      // (`sx={{ ...defaults, ...sx }}`), and spreading a function yields
      // nothing at all — the styles vanish silently, which is exactly how the
      // first version of this shipped with no variants and no effects.
      sx={{
        // The same corner the row uses: a Grade and a Lista of the same records
        // sit beside each other, and a tile that rounds harder than the row
        // reads as a different component.
        borderRadius: CARD_RADIUS,
        // The shared half — variant, colour, selection, effects — identical to
        // the one BaseListCard uses, so a Grade and a Lista of the same records
        // are dressed by one set of rules.
        ...cardSurfaceStyles(
          {
            ...props,
            selectable,
            shape: "tile",
            // A card mid-drag is a ghost of itself; the drop target is what the
            // eye should be on.
            state: drag.dragging ? "disabled" : props.state,
          },
          theme,
        ),
        // …and the tile's own geometry on top.
        ...cardSx({
          aspectRatio, pad, scale,
          interactive: onClick != null,
          draggable: drag.draggable && drag.handleProps === undefined,
        }),
      }}
    >
      {/* Bottom-left, opposite the menu and clear of the checkbox — a grip in
          the same corner as a control that toggles selection means every drag
          starts with a near-miss on it. */}
      {drag.draggable && (
        <Box sx={{ position: "absolute", bottom: 4, left: 4, zIndex: 2 }}>
          <DragHandle
            handleProps={drag.handleProps}
            gated={drag.handleProps !== undefined}
            testId={slot("drag")}
          />
        </Box>
      )}
      <CardOverlays
        selected={selected}
        onToggleSelect={selectable ? onToggleSelect ?? (() => {}) : undefined}
        checkboxTestId={checkboxTestId}
        menu={menu}
      />
      <CardContents
        image={props.image}
        imageFallback={props.imageFallback}
        title={props.title}
        subtitle={props.subtitle}
        overlays={selectable || menu != null}
        pad={pad}
      >
        {props.children}
      </CardContents>
    </Card>
  );
}
