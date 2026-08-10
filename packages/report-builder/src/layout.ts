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

/**
 * THREE HEIGHTS, and why they are not an arithmetic scale (FUT-755).
 *
 * The width axis is arithmetic because the canvas gives it a unit: a span is a
 * number of twelfths of a real container. The vertical axis has no such unit —
 * `ReportGrid` is a wrapped flex row rather than a CSS grid (`visual-pass.md`
 * §Layout: a real grid leaves an orphan hole), so there is no row TRACK to span
 * and never was. A block's height has always been its own content.
 *
 * The first attempt invented a unit anyway — a 140px "row", `N` of them plus
 * their gutters — and it failed the only test that matters, which is whether an
 * author can SEE the difference: 300px against 440px is two charts that look
 * alike, and the user set one block to `Média` and then to `Alta` and reported
 * the two as "almost nothing".
 *
 * So a height is a TIER, and a tier is stated the way a reader experiences one:
 * as a fraction of the window, floored and capped so it stays sane on a laptop
 * in a short window and on a 4K panel. Each tier is roughly twice the one below
 * it at any viewport, which is the point — three sizes nobody has to compare
 * side by side to tell apart.
 */
export const BLOCK_HEIGHT_MIN = 1;
export const BLOCK_HEIGHT_MAX = 3;

/** One tier's floor, its share of the window, and its ceiling. */
interface BlockHeightTier {
  minPx: number;
  vh: number;
  maxPx: number;
}

/**
 * `Baixa` · `Média` · `Alta`, in order.
 *
 * The floors are what each has to be to READ — 200px is a chart with a plot
 * rather than a band of axis labels, which is why no tier is refused to any
 * presentation any more. The ceilings stop `Alta` becoming a block nobody can
 * see the bottom of on a tall screen.
 */
const BLOCK_HEIGHT_TIERS: readonly BlockHeightTier[] = [
  { minPx: 200, vh: 24, maxPx: 280 },
  { minPx: 340, vh: 44, maxPx: 500 },
  { minPx: 520, vh: 68, maxPx: 780 },
];

/**
 * A height the canvas can render, or `undefined` for the block's own content.
 *
 * `undefined` in, `undefined` out — that is the compatibility contract. A block
 * saved before heights existed carries none and must go on measuring exactly
 * what its content measures; only a height somebody actually chose is clamped.
 * Junk resolves to something valid rather than throwing, as {@link clampBlockSpan}
 * does: layout is never the reason a saved report fails to open.
 *
 * It takes no presentation, unlike {@link clampBlockSpan}. A narrow block
 * TRUNCATES — a table in a third of the canvas loses columns — so widths need a
 * floor per presentation. A short block does not: every tier is tall enough to
 * read, and anything taller than its tier simply outgrows it.
 */
export function clampBlockHeight(height: number | undefined): number | undefined {
  if (height === undefined) return undefined;
  if (!Number.isFinite(height)) return BLOCK_HEIGHT_MIN;
  return Math.min(BLOCK_HEIGHT_MAX, Math.max(BLOCK_HEIGHT_MIN, Math.round(height)));
}

/**
 * What a tier is worth on screen, as the CSS the cell carries.
 *
 * Applied as a MINIMUM, never a maximum: a thirty-row table in a `Baixa` block
 * must outgrow its tier rather than be clipped, because a report that hides
 * data is worse than one taller than it was asked to be.
 */
export function blockHeightCss(height: number): string {
  const index = (clampBlockHeight(height) ?? BLOCK_HEIGHT_MIN) - 1;
  const tier = BLOCK_HEIGHT_TIERS[index] ?? BLOCK_HEIGHT_TIERS[0];
  if (tier === undefined) return '0px';
  return `clamp(${tier.minPx}px, ${tier.vh}vh, ${tier.maxPx}px)`;
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
