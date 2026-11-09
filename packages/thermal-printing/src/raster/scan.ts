/**
 * The scan that filling and estimating share: a shape's edges, the edges a
 * sub-row crosses, and the spans the fill rule paints along it. The fill
 * (`./fill`) writes those spans; the estimate (`./estimate`) counts them. One
 * walk for both is what keeps the estimate an upper bound on the fill.
 */
import type { Shape } from "./svg-doc";
import type { Point } from "./svg-path";

export const SUBROWS = 4;

export interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** +1 downward, -1 upward: what the nonzero rule counts. */
  dir: 1 | -1;
}

export function edgesOf(polygons: readonly Point[][]): Edge[] {
  const edges: Edge[] = [];
  for (const polygon of polygons) {
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length] ?? a;
      if (a[1] === b[1]) return;
      // A non-finite coordinate (an overflowing transform) cannot be scanned.
      if (![a[0], a[1], b[0], b[1]].every(Number.isFinite)) return;
      edges.push(
        a[1] < b[1]
          ? { x0: a[0], y0: a[1], x1: b[0], y1: b[1], dir: 1 }
          : { x0: b[0], y0: b[1], x1: a[0], y1: a[1], dir: -1 },
      );
    });
  }
  return edges;
}

/**
 * Where edge `e` crosses the horizontal line `y`: `x0 + t × (x1 - x0)`, the
 * same arithmetic as always while the differences are finite. An edge whose
 * run overflows (ends near ±1e308) made that `x0 + t × Infinity`: +-Infinity
 * on most sub-rows and 0 × Infinity = NaN on one exactly at its top, which
 * drew spans the shape does not have and left a NaN-ended row uncomposited,
 * its coverage carried into a later row or shape. Such an edge is
 * interpolated as `(1 - t) × x0 + t × x1` instead, with `t` from halved
 * coordinates when the rise overflows too: finite, and where the edge is.
 */
function crossingX(e: Edge, y: number): number {
  const rise = e.y1 - e.y0;
  const t = Number.isFinite(rise) ? (y - e.y0) / rise : (y / 2 - e.y0 / 2) / (e.y1 / 2 - e.y0 / 2);
  const run = e.x1 - e.x0;
  return Number.isFinite(run) ? e.x0 + t * run : (1 - t) * e.x0 + t * e.x1;
}

/** Where each edge crosses the horizontal line `y`, with its direction. */
function crossings(edges: readonly Edge[], y: number): { x: number; dir: number }[] {
  const out: { x: number; dir: number }[] = [];
  for (const e of edges) {
    if (y < e.y0 || y >= e.y1) continue;
    out.push({ x: crossingX(e, y), dir: e.dir });
  }
  return out.sort((a, b) => a.x - b.x);
}

/**
 * The edges a sub-row can cross, kept as it moves down the shape.
 *
 * Edges are sorted by their top once; each sub-row admits the ones that have
 * started and drops the ones that have ended. So a sub-row costs the edges
 * that actually span it, not every edge of the shape — which is what keeps a
 * path with a hundred thousand segments from costing that much on every row.
 */
export class ActiveEdges {
  private next = 0;
  private active: Edge[] = [];
  private readonly sorted: Edge[];

  constructor(edges: readonly Edge[]) {
    this.sorted = [...edges].sort((a, b) => a.y0 - b.y0);
  }

  /**
   * The first row at or after `y` an edge can reach, when none does before
   * it: `y` itself while an edge is still active or about to start.
   */
  idleUntil(y: number): number {
    if (this.active.some((edge) => edge.y1 > y)) return y;
    const next = this.sorted[this.next]?.y0 ?? Infinity;
    return Math.max(y, Math.floor(next));
  }

  at(y: number): Edge[] {
    while (this.next < this.sorted.length && (this.sorted[this.next]?.y0 ?? Infinity) <= y) {
      this.active.push(this.sorted[this.next] as Edge);
      this.next += 1;
    }
    this.active = this.active.filter((edge) => edge.y1 > y);
    return this.active;
  }
}

/**
 * The first and last pixel a span [x0, x1) covers on a row `width` wide; the
 * fill and the estimate share them. A span ending exactly on a pixel boundary
 * does not reach the pixel after it.
 */
export const firstPixel = (x0: number): number => Math.max(0, Math.floor(x0));
export const lastPixel = (x1: number, width: number): number => Math.min(width - 1, Math.ceil(x1) - 1);

/**
 * Walk one sub-row's crossings and hand each span the fill rule paints to
 * `onSpan`, left to right. Returns how many edges it visited. The fill and
 * the estimate both scan through here, so they cannot disagree on a span.
 */
export function scanSubrow(
  active: ActiveEdges,
  y: number,
  rule: Shape["rule"],
  onSpan: (x0: number, x1: number) => void,
): number {
  const edges = active.at(y);
  let winding = 0;
  let start = 0;
  for (const { x, dir } of crossings(edges, y)) {
    const wasInside = rule === "evenodd" ? winding % 2 !== 0 : winding !== 0;
    winding += rule === "evenodd" ? 1 : dir;
    const isInside = rule === "evenodd" ? winding % 2 !== 0 : winding !== 0;
    if (!wasInside && isInside) start = x;
    else if (wasInside && !isInside) onSpan(start, x);
  }
  return edges.length;
}

/** Counters a caller (a test) can pass to `paint` to see what it did. */
export interface PaintStats {
  rowsFilled: number;
  /**
   * The scan-conversion work `paint` actually did, in the units the estimate
   * charges (see `Plan`): per sub-row, the edges visited times the sort
   * factor plus the pixels written (at least one); per row, the pixels
   * composited (at least one). Added to when present.
   */
  work?: number;
  /** The work the estimate's own scans did, in the same units: edge visits times the sort factor, one per sub-row. */
  scanWork?: number;
}

/** A shape with its edges, prepared once for both the estimate and the fill. */
export interface Prepared {
  shape: Shape;
  edges: Edge[];
}

/** The log factor of sorting one sub-row's crossings, for a shape of `edges`. */
export const sortFactor = (edges: readonly Edge[]): number => Math.ceil(Math.log2(edges.length + 2));

/** The pixel rows the fill loops over for `edges`: [top, bottom), inside the canvas. */
export function rowRange(edges: readonly Edge[], height: number): [number, number] {
  // A reduce, not Math.min(...spread): a spread of a huge path overflows the stack.
  const top = Math.max(0, Math.floor(edges.reduce((m, e) => Math.min(m, e.y0), Infinity)));
  const bottom = Math.min(height, Math.ceil(edges.reduce((m, e) => Math.max(m, e.y1), -Infinity)));
  return [top, Math.max(top, bottom)];
}
