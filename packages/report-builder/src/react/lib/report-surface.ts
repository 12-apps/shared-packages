/**
 * The reports area's visual surface (`docs/reports-builder/visual-pass.md`).
 *
 * One module for the handful of values that must agree across every reports
 * screen — the canvas, the two radii, the one control height, the type scale's
 * top step — because the alternative is what the visual pass found: four radii
 * in one subtree, four control heights in one toolbar row, and a card title
 * sized like body text.
 *
 * They live here rather than in `report-grid` so the renderer can reach them
 * too: `report-grid` renders `report-render`, so anything the renderer imports
 * back out of it would close a module cycle and leave these constants in the
 * temporal dead zone at import time.
 */
import { useMemo, type CSSProperties } from "react";

import { createTheme, useTheme, type Theme } from "@12-apps/ui/mui/styles";

/** The canvas gap, in px, so a block's flex basis can subtract it exactly. */
export const GRID_GAP_PX = 16;

/**
 * TWO radii, and only two (`visual-pass.md` §Components): everything that is a
 * CONTAINER — a card, a dialog, the canvas itself — rounds by one value, and
 * everything that is a CONTROL inside one rounds by the other. The editor
 * subtree used to carry four (4px, 8px, 2px and a 50%), which is what makes a
 * screen read as assembled from parts rather than designed.
 */
export const CONTAINER_RADIUS_PX = 12;
export const CONTROL_RADIUS_PX = 8;

/**
 * One height for every control that shares a row. A 36px button beside a 40px
 * select reads as broken, and the toolbars measured 36.5 / 38.5 / 40 / 44.5 —
 * four heights in one line, none of them chosen.
 */
export const CONTROL_HEIGHT_PX = 36;

/**
 * The reports area's surface: what makes the screens look like one product.
 *
 * A page applies it to its outermost element. It carries three things nothing
 * smaller can:
 *
 *  - **a canvas** (`visual-pass.md` §Depth). Cards were white on a white page
 *    with a 1px border, so a block was separated from the page by its border
 *    ALONE. The prototype's canvas is grey and its surfaces are white; this is
 *    that, in theme tokens.
 *  - **one radius family**, applied to controls wherever they come from —
 *    including the ones this package does not render itself.
 *  - **one field style and one type size for a field's value.** MUI's outlined
 *    field renders its value at 16px, which was LARGER than the block titles
 *    and section headings labelling it.
 */
export const REPORT_SURFACE_SX = {
  bgcolor: "grey.100",
  borderRadius: `${CONTAINER_RADIUS_PX}px`,
  p: { xs: 2, md: 3 },
  // Digits line up in a column wherever they are rendered — table cells, KPI
  // tiles and (inherited into the SVG) axis ticks.
  fontVariantNumeric: "tabular-nums",
  // `[aria-keyshortcuts]` is the block's focusable group — a container, so it
  // rounds like one. Matched by that attribute rather than by `role="group"`,
  // which a `ToggleButtonGroup` also carries and which is a CONTROL.
  "& .MuiPaper-root, & .MuiCard-root, & .MuiTable-root, & [aria-keyshortcuts]": {
    borderRadius: `${CONTAINER_RADIUS_PX}px`,
  },
  "& .MuiButtonBase-root, & .MuiToggleButton-root, & .MuiChip-root": {
    borderRadius: `${CONTROL_RADIUS_PX}px`,
  },
  "& .MuiInputBase-root, & .MuiOutlinedInput-root, & .MuiSelect-select": {
    borderRadius: `${CONTROL_RADIUS_PX}px`,
  },
  // A shadow means "this floats above the page". A button does not.
  "& .MuiButton-root": { boxShadow: "none" },
  // A secondary button stands ON the canvas, so it carries the surface colour
  // (`prototype.html`'s `.btn` is `background:var(--surface)`). Left transparent
  // it borrowed the tint, and its accent label measured 4.10:1 there against
  // 4.47:1 on paper — the canvas introduced above cost contrast the rule in
  // `visual-pass.md` §Colour asks for. It also stops reading as a bare label.
  "& .MuiButton-outlined": { bgcolor: "background.paper" },
  "& .MuiInputBase-input, & .MuiInputLabel-root": { fontSize: "0.875rem" },
} as const;

/**
 * The SECTION level of the type scale — "Agrupar por", "Medidas", "Filtros".
 *
 * It is the level `visual-pass.md` §Type lists between the page title and a
 * card title, and the one this area did not have: these headings rendered at
 * 12px/600 beside field labels at 12px/400, so two levels sat at exactly the
 * same size and WEIGHT was the only thing telling them apart — which is the
 * rule's other half ("One weight per level").
 *
 * Rather than invent a fifth size and squeeze the ladder (24 / 18 / 14 / 12,
 * whose steps are 6 / 4 / 2), the section becomes a different KIND of label:
 * uppercase and letterspaced, the way `prototype.html`'s `.eyebrow` sets every
 * group heading in this panel. Case and tracking are visible at a glance where
 * a 1px size difference is not, and the ladder keeps four steps.
 */
export const SECTION_LABEL_STYLE: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontSize: "0.75rem",
  fontWeight: 600,
};

/**
 * The reports surface, plus the two things only the EDITOR needs.
 *
 * **One field style** (`visual-pass.md` §Components). The editor's own metadata
 * fields render at MUI's `medium` metric (56px tall) while the block panel's
 * selects render at `small` (40px), in a single column — two field styles in
 * one form, which is the "default component identity" failure the visual pass
 * ranks third. The rules below give every field in the editor one shape,
 * whatever rendered it, and they reach the config panel because a docked or
 * overlay panel is a persistent drawer: a real element inside that tree.
 *
 * **A block's title is a title, not a field.** In edit mode the frame's title
 * slot is an `Input`, so without this the block title would read at body size
 * in the editor and at title size in the viewer — the one difference between
 * the two modes `ReportGrid` exists to prevent.
 */
export const EDITOR_SURFACE_SX = {
  ...REPORT_SURFACE_SX,
  "& .MuiOutlinedInput-root": {
    height: `${CONTROL_HEIGHT_PX}px`,
    boxSizing: "border-box",
    alignItems: "center",
  },
  "& .MuiOutlinedInput-input": { paddingTop: 0, paddingBottom: 0 },
  "& .MuiInputLabel-outlined:not(.MuiInputLabel-shrink)": {
    transform: "translate(14px, 8px) scale(1)",
  },
  '& input[data-testid$="-title"]': { fontSize: "1.125rem", fontWeight: 600 },
  // …and it is not a BOX either. Sized like a title but framed like a field, a
  // block's title slot put an outlined input in the one row that is supposed to
  // read as a heading — a second field style in the block header, on top of the
  // panel's. `prototype.html`'s `.title-input` is a transparent border that
  // appears on hover and focus: editable when you reach for it, a title until
  // then. The sibling combinator does the work MUI's DOM order allows — the
  // notched outline is rendered after the input inside the same root.
  '& input[data-testid$="-title"] ~ .MuiOutlinedInput-notchedOutline': {
    borderColor: "transparent",
  },
  '& input[data-testid$="-title"]:hover ~ .MuiOutlinedInput-notchedOutline': {
    borderColor: "divider",
  },
  '& input[data-testid$="-title"]:focus ~ .MuiOutlinedInput-notchedOutline': {
    borderColor: "primary.main",
  },
} as const;

/**
 * The same field shape, for the panels that render through a PORTAL.
 *
 * {@link EDITOR_SURFACE_SX} is a descendant selector, so it stops at the edge
 * of the editor's DOM — and below 760px the block's configuration panel becomes
 * a modal bottom sheet, which MUI portals to `<body>`. Its selects measured
 * 40px at a 4px radius while every field on the page behind it measured 36px at
 * 8px: one field style on a desktop and two on a phone, which is the defect
 * with a viewport attached.
 *
 * A theme reaches it because React context crosses a portal even though the DOM
 * does not. Same numbers, stated once more where a selector cannot go — and the
 * radius family with them: measured inside the sheet, `.MuiSelect-select` came
 * back at MUI's own 4px and the header's close control at 50%, so the phone saw
 * FOUR radii where the desktop saw two.
 */
export function useReportPortalTheme(): Theme {
  const base = useTheme();
  return useMemo(
    () =>
      createTheme(base, {
        components: {
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                height: CONTROL_HEIGHT_PX,
                boxSizing: "border-box",
                alignItems: "center",
                borderRadius: CONTROL_RADIUS_PX,
              },
              input: { paddingTop: 0, paddingBottom: 0, fontSize: "0.875rem" },
            },
          },
          MuiInputLabel: {
            styleOverrides: {
              root: { fontSize: "0.875rem" },
              outlined: {
                "&:not(.MuiInputLabel-shrink)": { transform: "translate(14px, 8px) scale(1)" },
              },
            },
          },
          // The select's inner display box rounds on its own, under the
          // outlined root — 4px, MUI's default, visible at the corners.
          MuiSelect: { styleOverrides: { select: { borderRadius: CONTROL_RADIUS_PX } } },
          // A circle is not one of the two values (`visual-pass.md`
          // §Components). The page's own rule squares it; the sheet is
          // portaled out of reach of that rule and was the last 50% left.
          MuiIconButton: { styleOverrides: { root: { borderRadius: CONTROL_RADIUS_PX } } },
        },
      }),
    [base],
  );
}

/**
 * The page title, and the top of the ONE type scale these screens use.
 *
 * Four levels, and the gap between them is the point: page title 24, title
 * (report name, card name, block title) 18, body 14, caption 12. Every step
 * used to be exactly 2px — 18/16/14/12, all at weight 600 — so "page title",
 * "card title" and "body" were the same size to a reader and the hierarchy was
 * carried by weight alone.
 *
 * The size is the theme's `h5`, not a number: `Text`'s own scale stops at 20px,
 * which is not far enough from a block title to read as a different level.
 */
export const PAGE_TITLE_SX = { typography: "h5", fontWeight: 600, m: 0 } as const;

/**
 * The controls in one toolbar row, all exactly {@link CONTROL_HEIGHT_PX} tall.
 *
 * Height alone is not enough for a text field: MUI's input keeps its own
 * vertical padding, so the field would overflow the box it was just given.
 * Zeroing that padding lets the flex row centre the text instead.
 */
export const CONTROL_ROW_SX = {
  "& .MuiButtonBase-root, & .MuiInputBase-root, & .MuiToggleButtonGroup-root": {
    height: `${CONTROL_HEIGHT_PX}px`,
    minHeight: `${CONTROL_HEIGHT_PX}px`,
    boxSizing: "border-box",
  },
  "& .MuiInputBase-input": { paddingTop: 0, paddingBottom: 0 },
} as const;
