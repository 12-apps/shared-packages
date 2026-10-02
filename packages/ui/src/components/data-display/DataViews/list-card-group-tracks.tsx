"use client";

import type { Theme } from "@mui/material/styles/index.js";
import type { ReactNode } from "react";

import { Box } from "../../../mui/Box";
import { rem } from "../../../tokens/relative";
import { COMPACT_BREAK } from "./list-card-breaks";

/**
 * A GROUP'S TRACKS, AND WHICH OF ITS HEAD GUTTERS GET ONE.
 *
 * Every row of a group is subgrid over one template, so the tracks cannot vary
 * per row — but the group does not render its rows' gutters and cannot count
 * which of them are in use. The rows answer that for it: inside a group every
 * gutter slot renders, as an EMPTY element when the row does not use it, and
 * the group asks with `:has()` whether any row's slot has content. A gutter no
 * row fills loses its track (and its rail gap) and its placeholders are hidden,
 * so auto-placement has nothing to put in the wrong column; one any row fills
 * is a track for every row, so the list still lines up.
 *
 * WHICH GUTTERS MAY LEAVE:
 *   - `reserveGutters={false}`: any of the three, at every width.
 *   - reserved (the default): only the drag gutter, and only in the compact
 *     band. Held open it keeps a selectable list and a read-only one aligned
 *     and stops drag mode shifting every row; on a phone-sized row, with no
 *     row dragging, it is a rail gap spent on nothing.
 *
 * Each rule names every candidate gutter, empty or filled, so exactly one rule
 * matches a given list and none depends on another's specificity to lose.
 */

export type Gutter = "disclose" | "drag" | "select";

const GUTTERS: readonly Gutter[] = ["disclose", "drag", "select"];

/** A `:has()` argument true when some row's `gutter` slot has content. */
const filled = (gutter: Gutter): string => `> * > [data-slot="${gutter}"] > *`;

/** Every non-empty subset of `gutters`, in a stable order. */
function subsets(gutters: readonly Gutter[]): Gutter[][] {
  const out: Gutter[][] = [];
  for (let mask = 1; mask < 1 << gutters.length; mask += 1) {
    out.push(gutters.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return out;
}

/** The template for a list with `dropped` gutters, plain or compact. */
export type GroupTemplate = (dropped: ReadonlySet<Gutter>, compact: boolean) => string;

/**
 * The rules for one width: the template with no gutter dropped, then one rule
 * per combination of empty candidate gutters.
 */
function trackRules(
  template: GroupTemplate,
  railCount: number,
  candidates: readonly Gutter[],
  compact: boolean,
): Record<string, unknown> {
  const rules: Record<string, unknown> = { gridTemplateColumns: template(new Set(), compact) };
  for (const empty of subsets(candidates)) {
    const selector = candidates
      .map((gutter) => (empty.includes(gutter) ? `:not(:has(${filled(gutter)}))` : `:has(${filled(gutter)})`))
      .join("");
    rules[`&${selector}`] = {
      gridTemplateColumns: template(new Set(empty), compact),
      // Every row spans what is left, or it adds an implicit track at the end.
      // `> *`: every direct child of a group's grid is a row (DataViews renders
      // them through fragments for exactly this reason).
      "& > *": { gridColumn: `span ${railCount - empty.length}` },
      ...Object.fromEntries(empty.map((gutter) => [`& > * > [data-slot="${gutter}"]`, { display: "none" }])),
    };
  }
  return rules;
}

/** The group grid's `grid-template-columns`, at every width it answers. */
export function groupTracksSx(
  theme: Theme,
  { template, railCount, reserveGutters }: { template: GroupTemplate; railCount: number; reserveGutters: boolean },
): Record<string, unknown> {
  return {
    ...trackRules(template, railCount, reserveGutters ? [] : GUTTERS, false),
    [`@container (max-width: ${rem(theme, COMPACT_BREAK)})`]: trackRules(
      template,
      railCount,
      reserveGutters ? ["drag"] : GUTTERS,
      true,
    ),
  };
}

/**
 * The group's grid, inside its query container — the container for every row
 * in it: a row cannot be one itself and a subgrid at the same time
 * (containment drops subgrid), and every row in a list is the same width
 * anyway, so the group is the honest place to ask the question.
 *
 * A WRAPPER, not the grid: a container query matches an ancestor, never the
 * element itself, and the grid's own template has to answer the width (the
 * compact band, `list-card-group-tracks`). The rows stay the GRID's direct
 * children, which subgrid needs.
 */
export function GroupGrid({
  dataTestId,
  tracks,
  rowGap,
  children,
}: {
  dataTestId?: string;
  tracks: Parameters<typeof groupTracksSx>[1];
  rowGap: number;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Box sx={{ containerType: "inline-size", width: "100%", minWidth: 0 }}>
      <Box
        data-testid={dataTestId}
        sx={(theme) => ({ display: "grid", ...groupTracksSx(theme, tracks), alignItems: "center", rowGap })}
      >
        {children}
      </Box>
    </Box>
  );
}
