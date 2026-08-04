"use client";

import { type ReactNode } from "react";

import type { SxProps, Theme } from "@mui/material/styles";

import { Checkbox } from "../../form/Checkbox";
import { Card } from "../../layout/Card";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

import { CARD_ASPECT_RATIOS, type CardAspectRatio } from "./data-views-types";

interface BaseCardProps {
  /** Extra body content below the caption (chips, meta). Optional. */
  children?: ReactNode;
  /** Tile proportion. Defaults to "4:3". */
  aspectRatio?: CardAspectRatio;
  /**
   * Size multiplier from the zoom slider (1 = base). Scales the card's padding +
   * typography in step with its width (the grid sizes the track to base × scale),
   * so the whole card grows together — a card at scale 2 renders at ~twice the
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
  /** Whether this card is in the grid's selection. */
  selected?: boolean;
  /** Toggle this card's selection. Omit to hide the checkbox (non-selectable). */
  onToggleSelect?: () => void;
  /** Card click (e.g. open/edit). The checkbox/menu stop propagation. */
  onClick?: () => void;
  /** Visually de-emphasise (e.g. a disabled/hidden entity). */
  dimmed?: boolean;
  dataTestId?: string;
  checkboxTestId?: string;
}

/** The outlined-tile style: fixed ratio, scaled padding, selected/dimmed states. */
function cardSx(opts: {
  aspectRatio: CardAspectRatio;
  pad: number;
  interactive: boolean;
  dimmed: boolean;
  selected: boolean;
}): SxProps<Theme> {
  const { aspectRatio, pad, interactive, dimmed, selected } = opts;
  return {
    position: "relative",
    aspectRatio: String(CARD_ASPECT_RATIOS[aspectRatio]),
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    p: pad,
    transition: "border-color 120ms, box-shadow 120ms, background-color 120ms",
    cursor: interactive ? "pointer" : undefined,
    opacity: dimmed ? 0.6 : 1,
    borderColor: selected ? "primary.main" : undefined,
    boxShadow: selected ? (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}` : undefined,
    backgroundColor: selected ? "action.selected" : undefined,
  };
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
  scale,
  topGap,
}: {
  children: ReactNode;
  fill: boolean;
  scale: number;
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
        gap: 0.75 * scale,
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
  scale,
  topGap,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  scale: number;
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
            fontSize: `${0.95 * scale}rem`,
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
  scale,
  pad,
}: Pick<BaseCardProps, "children" | "image" | "imageFallback" | "title" | "subtitle"> & {
  scale: number;
  pad: number;
}): React.JSX.Element {
  const hasMedia = image != null || imageFallback != null;
  const hasBody = children != null;
  const hasCaption = title != null || subtitle != null;
  const gap = pad * 0.5;
  return (
    <>
      {hasMedia && <CardMedia image={image} imageFallback={imageFallback} />}
      {hasBody && (
        <CardBodyContent fill={!hasMedia} scale={scale} topGap={hasMedia ? gap : 0}>
          {children}
        </CardBodyContent>
      )}
      {hasCaption && (
        <CardCaption
          title={title}
          subtitle={subtitle}
          scale={scale}
          topGap={hasMedia || hasBody ? gap : 0}
        />
      )}
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
export function BaseCard(props: BaseCardProps): React.JSX.Element {
  const { aspectRatio = "4:3", scale = 1, selected = false, dimmed = false } = props;
  const { menu, onToggleSelect, onClick, dataTestId, checkboxTestId } = props;
  const pad = 1.5 * scale;

  return (
    <Card
      variant="outlined"
      borderRadius="lg"
      onClick={onClick}
      dataTestId={dataTestId}
      sx={cardSx({ aspectRatio, pad, interactive: onClick != null, dimmed, selected })}
    >
      <CardOverlays
        selected={selected}
        onToggleSelect={onToggleSelect}
        checkboxTestId={checkboxTestId}
        menu={menu}
      />
      <CardContents
        image={props.image}
        imageFallback={props.imageFallback}
        title={props.title}
        subtitle={props.subtitle}
        scale={scale}
        pad={pad}
      >
        {props.children}
      </CardContents>
    </Card>
  );
}
