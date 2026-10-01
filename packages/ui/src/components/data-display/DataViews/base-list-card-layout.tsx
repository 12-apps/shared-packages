"use client";

import { type ReactNode } from "react";

import { Box } from "../../../mui/Box";
import type { BaseListCardProps } from "./base-list-card";
import { rowGutters, type StackPlacement, type useRowShell } from "./base-list-card-geometry";
import { cellRailsTemplate } from "./list-card-rails";
import { cellTracks, useCellConfig, type ListCardCellConfig } from "./list-card-cells";

/**
 * WHAT SHAPE A ROW TAKES, resolved once: its cells and their template, whether
 * it ends in the "this opens" chevron, and what its two-line form keeps.
 *
 * Split from the card at the file-size gate. Everything here decides; nothing
 * here renders but the standalone container.
 */

/**
 * Which cell config applies, and whether this row resolves its own tracks.
 *
 * The list's config wins over the card's: one declaration of the list's shape is
 * the point, so a row inside a group cannot introduce a column of its own. And
 * the template is standalone-only — inside a group the GROUP owns it and the row
 * is subgrid over it, because a row resolving its own tracks is exactly what
 * stops a list from lining up.
 */
function useResolvedCells(
  props: BaseListCardProps,
  inGroup: boolean,
  gutters: { disclose: boolean; drag: boolean; select: boolean },
): {
  cells: readonly ListCardCellConfig<never>[] | null;
  configured: boolean;
  cellTemplate: string | null;
} {
  const groupCells = useCellConfig();
  const cells = groupCells ?? props.cells ?? null;
  const configured = cells != null && cells.length > 0 && props.row != null;
  const cellTemplate = configured && !inGroup ? cellRailsTemplate(cellTracks(cells), gutters) : null;
  return { cells, configured, cellTemplate };
}

/**
 * Whether the row ends in the "this opens" chevron: it is live and leads
 * somewhere it can actually go — a click handler, or a link the row renders.
 * Only a named-slot row with a title renders an anchor for `href` (the caption
 * wraps the title), so an `href` alone does not count elsewhere: a chevron on
 * a row that cannot open is the promise the disclosure chevron's docblock
 * warns about. Not when the row expands either:
 * the disclosure chevron already speaks, and a second arrow meaning something
 * else beside it would contradict it.
 */
function rowOpens(
  props: BaseListCardProps,
  shell: ReturnType<typeof useRowShell>,
  configured: boolean,
  expandable: boolean,
): boolean {
  if (expandable) return false;
  // The named-slot caption renders its anchor only around a title.
  return shell.acts || (shell.actionable && props.href != null && props.title != null && !configured);
}

/**
 * The cell that takes the VALUE's place when the row stacks: the one the config
 * marks `strong` ("the figure the row is really about"), else the last — as
 * long as it is not the first cell, which already holds the title's place.
 */
function valueCellId(cells: readonly ListCardCellConfig<never>[]): string | null {
  const first = cells[0];
  const candidate = cells.find((cell) => cell.strong === true && cell !== first) ?? cells[cells.length - 1];
  return candidate != null && candidate !== first ? candidate.id : null;
}

/** Everything the row's shape depends on, resolved once. */
export function useRowLayout(
  props: BaseListCardProps,
  shell: ReturnType<typeof useRowShell>,
  expandable: boolean,
): ReturnType<typeof useResolvedCells> & { opens: boolean; stack: StackPlacement } {
  const resolved = useResolvedCells(props, shell.group != null, rowGutters(props, shell));
  const cells = resolved.configured ? resolved.cells : null;
  return {
    ...resolved,
    opens: rowOpens(props, shell, resolved.configured, expandable),
    stack: {
      firstCell: cells?.[0]?.id ?? null,
      valueCell: cells == null ? null : valueCellId(cells),
      expandable,
    },
  };
}

/**
 * A standalone row's QUERY CONTAINER. A container query matches an ancestor,
 * never the element itself, so the row cannot be the container its own
 * two-line template asks about. In a group the group is the container, and the
 * row must stay its direct child for subgrid, so no wrapper there.
 */
export function StandaloneContainer({ inGroup, children }: { inGroup: boolean; children: ReactNode }): React.JSX.Element {
  if (inGroup) return <>{children}</>;
  return <Box sx={{ containerType: "inline-size", width: "100%", minWidth: 0 }}>{children}</Box>;
}
