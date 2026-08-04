/**
 * The report grid contract (FUT-391): a report is a 12-column canvas and every
 * block occupies 1..12 of those columns. Pure data + pure functions so the
 * authoring UI, the viewer and the tests all agree on ONE layout rule set.
 *
 * Minimum widths exist because a block is not a rectangle — it is a rendering.
 * A table squeezed into two columns truncates every header; a KPI tile stretched
 * to twelve is a lonely number on a banner. Each presentation therefore declares
 * the narrowest width at which it still READS, and the authoring UI clamps to it
 * instead of letting an author build an unreadable dashboard.
 */

/** Columns on the canvas — the denominator of every `span`. */
export const REPORT_GRID_COLUMNS = 12;

/** Narrowest/widest span the schema accepts (a presentation may raise the floor). */
export const BLOCK_SPAN_MIN = 1;
export const BLOCK_SPAN_MAX = REPORT_GRID_COLUMNS;

/**
 * The presentation facts the layout rules depend on — structurally satisfied by
 * both the parsed {@link import('./spec').ReportPresentation} and the SPA's wire
 * type, so neither side has to convert.
 */
export type PresentationShape =
  | { readonly kind: 'table' }
  | { readonly kind: 'chart'; readonly chartType: 'line' | 'bar' | 'area' | 'pie' | 'donut' }
  | { readonly kind: 'kpi' };

/**
 * The narrowest span at which a presentation still reads:
 *   - `kpi`   — one number and a caption; 2 columns is plenty.
 *   - `pie`/`donut` — round, so they degrade gracefully; 3 columns.
 *   - other charts — need horizontal room for the category axis; 4 columns.
 *   - `table` — columns + headers; below half the canvas it truncates; 6.
 */
export function minSpanForPresentation(presentation: PresentationShape): number {
  if (presentation.kind === 'kpi') return 2;
  if (presentation.kind === 'table') return 6;
  return presentation.chartType === 'pie' || presentation.chartType === 'donut' ? 3 : 4;
}

/**
 * A span the grid can render: an integer, at least the presentation's minimum,
 * at most the full canvas. Junk (NaN, 0, 99, 7.5) resolves to something valid
 * rather than throwing — layout is never the reason a saved report fails to open.
 */
export function clampBlockSpan(span: number, presentation: PresentationShape): number {
  const min = minSpanForPresentation(presentation);
  if (!Number.isFinite(span)) return min;
  return Math.min(BLOCK_SPAN_MAX, Math.max(min, Math.round(span)));
}

/** The width options an author may pick for a presentation (its minimum upward). */
export function spanOptionsFor(presentation: PresentationShape): number[] {
  const min = minSpanForPresentation(presentation);
  const options: number[] = [];
  for (let span = min; span <= BLOCK_SPAN_MAX; span += 1) options.push(span);
  return options;
}

/** The screen the canvas is being drawn on. */
export type ViewportTier = 'phone' | 'tablet' | 'desktop';

/**
 * The span a block actually occupies on a narrower screen.
 *
 * The canvas stays 12 columns everywhere — collapsing it to a single stacked
 * column would throw away the author's layout entirely, and four KPI tiles
 * that read fine side by side on a phone would each get a full row. Instead
 * every span WIDENS by tier: the narrower the screen, the larger the share a
 * block takes, until anything substantial (a third of the canvas or more) owns
 * its own row on a phone.
 *
 * The two anchors are the product rule: one column becomes three on a phone
 * (four tiles per row), and four columns or more become the full width.
 * Widening is monotone across tiers — a block is never relatively narrower on
 * a phone than on a tablet.
 */
export function responsiveSpan(span: number, tier: ViewportTier): number {
  const columns = clampSpanToGrid(span);
  if (tier === 'desktop') return columns;
  if (tier === 'phone') {
    if (columns <= 1) return 3;
    if (columns <= 3) return 6;
    return BLOCK_SPAN_MAX;
  }
  if (columns <= 1) return 2;
  if (columns <= 3) return 3;
  if (columns <= 6) return 6;
  return BLOCK_SPAN_MAX;
}

/** A stored span narrowed to the grid, ignoring presentation floors. */
function clampSpanToGrid(span: number): number {
  if (!Number.isFinite(span)) return BLOCK_SPAN_MIN;
  return Math.min(BLOCK_SPAN_MAX, Math.max(BLOCK_SPAN_MIN, Math.round(span)));
}
