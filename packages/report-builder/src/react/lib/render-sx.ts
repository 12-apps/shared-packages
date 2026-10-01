/**
 * The rendering's own boxes — the figures' numerals and the chart's container —
 * kept beside `report-render.tsx` so that file holds what a rendering IS.
 */

/**
 * Every figure a report rendering draws, in tabular figures.
 *
 * Nothing set `font-variant-numeric` anywhere, so a column of currency lined up
 * only because Roboto happens to ship uniform digit advances — a font swap in a
 * host's theme would have shredded it silently. It is declared once, on each
 * rendering's outermost box, and inherits into table cells, the KPI tile and
 * (SVG text inherits it too) the axis ticks.
 */
export const TABULAR_FIGURES = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * The chart's own box, and the three things it corrects in the chart library.
 *
 * **No shadow on a static card** (`visual-pass.md` §Depth). `SpecChart` renders
 * onto a MUI `Paper`, which arrives with elevation 1 — so a shadowed card sat
 * inside the bordered block card that already frames it. Shadows belong to
 * floating layers: menus, sheets, drag ghosts.
 *
 * **A large fill is never the accent at full strength.** A bar is ~150px of
 * solid `#6366f1` across a card, which dominates every other element on the
 * page including the controls that actually do something. Dropping the fill
 * short of opaque is the cheapest way to put it back behind the text, and it
 * costs the series nothing: the stroke and the legend swatch stay the accent.
 */
export const CHART_BOX_SX = {
  ...TABULAR_FIGURES,
  // The radius itself comes from the page's surface, which rounds every
  // container to one value; importing it here would close a cycle back through
  // `report-grid`, which renders this file.
  // No second padding either: the block card already pads its content, and the
  // chart's own 16px on each side came straight out of the plot on a phone.
  "& .MuiPaper-root": { boxShadow: "none", backgroundImage: "none", padding: 0 },
  "& .recharts-bar-rectangle path, & .recharts-rectangle, & path.recharts-sector": {
    fillOpacity: 0.82,
  },
} as const;
