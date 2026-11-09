/**
 * Scan conversion: filled polygons to anti-aliased RGBA, in plain arithmetic.
 *
 * Each pixel row is sampled at {@link SUBROWS} heights; along each sub-row the
 * spans inside the shape are accumulated with EXACT horizontal coverage, so an
 * edge pixel gets the fraction of it the shape covers. The coverage then
 * composites the shape's colour over what is already there, painter's order,
 * which is how SVG paints.
 */
import { MAX_FILL_WORK, type Budget } from "./budget";
import type { Shape } from "./svg-doc";
import type { Point } from "./svg-path";

const SUBROWS = 4;

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** +1 downward, -1 upward: what the nonzero rule counts. */
  dir: 1 | -1;
}

function edgesOf(polygons: readonly Point[][]): Edge[] {
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

/** Where each edge crosses the horizontal line `y`, with its direction. */
function crossings(edges: readonly Edge[], y: number): { x: number; dir: number }[] {
  const out: { x: number; dir: number }[] = [];
  for (const e of edges) {
    if (y < e.y0 || y >= e.y1) continue;
    out.push({ x: e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), dir: e.dir });
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
class ActiveEdges {
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
 * Add `weight` × the covered fraction of each pixel in [x0, x1) to `row`;
 * returns how many pixels it wrote, which is what `PaintStats.work` counts.
 */
function addSpan(row: Float32Array, x0: number, x1: number, weight: number): number {
  const a = Math.max(0, x0);
  const b = Math.min(row.length, x1);
  if (b <= a) return 0;
  const i0 = Math.floor(a);
  const i1 = Math.floor(b);
  if (i0 === i1) {
    row[i0] = (row[i0] ?? 0) + (b - a) * weight;
    return 1;
  }
  row[i0] = (row[i0] ?? 0) + (i0 + 1 - a) * weight;
  for (let i = i0 + 1; i < i1; i += 1) row[i] = (row[i] ?? 0) + weight;
  // A span ending on a pixel boundary covers none of the pixel after it.
  if (b <= i1) return i1 - i0;
  row[i1] = (row[i1] ?? 0) + (b - i1) * weight;
  return i1 - i0 + 1;
}

/**
 * The first and last pixel a span [x0, x1) covers on a row `width` wide; the
 * fill and the estimate share them. A span ending exactly on a pixel boundary
 * does not reach the pixel after it.
 */
const firstPixel = (x0: number): number => Math.max(0, Math.floor(x0));
const lastPixel = (x1: number, width: number): number => Math.min(width - 1, Math.ceil(x1) - 1);

/** A reusable coverage row, and the pixel range the current row has touched. */
interface Row {
  coverage: Float32Array;
  min: number;
  max: number;
}

/**
 * Walk one sub-row's crossings and hand each span the fill rule paints to
 * `onSpan`, left to right. Returns how many edges it visited. The fill and
 * the estimate both scan through here, so they cannot disagree on a span.
 */
function scanSubrow(
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

/** Accumulate a span into `row`; returns the pixels written. */
function addCovered(row: Row, x0: number, x1: number): number {
  const a = firstPixel(x0);
  const b = lastPixel(x1, row.coverage.length);
  if (b < a) return 0;
  row.min = Math.min(row.min, a);
  row.max = Math.max(row.max, b);
  return addSpan(row.coverage, x0, x1, 1 / SUBROWS);
}

/**
 * Composite one row's coverage of `shape` into the premultiplied canvas —
 * only across the pixels the shape touched on this row, and clear them for the
 * next row as it goes. A small shape on a wide canvas costs its own width.
 * Returns the pixels visited: from the row's leftmost touched pixel to its
 * rightmost, holes between them included.
 */
function compositeRow(canvas: Float32Array, row: Row, y: number, rgba: Shape["rgba"]): number {
  const width = row.coverage.length;
  const [r, g, b, a] = [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255];
  for (let x = row.min; x <= row.max; x += 1) {
    const coverage = row.coverage[x] ?? 0;
    row.coverage[x] = 0;
    if (coverage <= 0) continue;
    const alpha = Math.min(1, coverage) * a;
    const o = (y * width + x) * 4;
    canvas[o] = r * alpha + (canvas[o] ?? 0) * (1 - alpha);
    canvas[o + 1] = g * alpha + (canvas[o + 1] ?? 0) * (1 - alpha);
    canvas[o + 2] = b * alpha + (canvas[o + 2] ?? 0) * (1 - alpha);
    canvas[o + 3] = alpha + (canvas[o + 3] ?? 0) * (1 - alpha);
  }
  const visited = row.max >= row.min ? row.max - row.min + 1 : 0;
  row.min = Infinity;
  row.max = -Infinity;
  return visited;
}

/** Counters a caller (a test) can pass to `paint` to see what it did. */
export interface PaintStats {
  rowsFilled: number;
  /**
   * The scan-conversion work `paint` actually did, in the units the estimate
   * charges (see `shapeWork`): per sub-row, the edges visited times the sort
   * factor plus the pixels written (at least one); per row, the pixels
   * composited (at least one). Added to when present.
   */
  work?: number;
}

interface Target {
  canvas: Float32Array;
  row: Row;
  height: number;
  stats: PaintStats;
}

/** A shape with its edges, prepared once for both the estimate and the fill. */
interface Prepared {
  shape: Shape;
  edges: Edge[];
}

/** The log factor of sorting one sub-row's crossings, for a shape of `edges`. */
const sortFactor = (edges: readonly Edge[]): number => Math.ceil(Math.log2(edges.length + 2));

/** The pixel rows the fill loops over for `edges`: [top, bottom), inside the canvas. */
function rowRange(edges: readonly Edge[], height: number): [number, number] {
  // A reduce, not Math.min(...spread): a spread of a huge path overflows the stack.
  const top = Math.max(0, Math.floor(edges.reduce((m, e) => Math.min(m, e.y0), Infinity)));
  const bottom = Math.min(height, Math.ceil(edges.reduce((m, e) => Math.max(m, e.y1), -Infinity)));
  return [top, Math.max(top, bottom)];
}

/** Σ over edges of the sub-rows each spans inside the canvas. */
const edgeSubrows = (edges: readonly Edge[], height: number): number =>
  edges.reduce((sum, e) => sum + Math.max(0, Math.min(e.y1, height) - Math.max(e.y0, 0)) * SUBROWS, 0);

/**
 * What a shape costs however little it paints, in O(edges): every edge
 * visited on every sub-row it spans, times the sort factor, plus one unit per
 * sub-row and one per row the fill loops over. It is a LOWER bound of
 * `shapeWork`, and it also bounds the cost of {@link paintedExcess}, the scan
 * that completes the estimate.
 */
function scanFloor(edges: readonly Edge[], height: number): number {
  const [top, bottom] = rowRange(edges, height);
  return edgeSubrows(edges, height) * sortFactor(edges) + (bottom - top) * (SUBROWS + 1);
}

/**
 * The rest of `shapeWork` past {@link scanFloor}, by scanning the shape's
 * sub-rows exactly as the fill will, but counting the pixels each painted span
 * reaches instead of writing them: per sub-row, the pixels past the first;
 * per row, the composited extent past its first pixel; and any edge visits
 * the fractional count in the floor missed.
 *
 * Its own cost is the edge visits and sub-rows the floor already charged,
 * each span counted in O(1): linear in edges × sub-rows spanned, never in
 * the pixel area. A span that reaches no pixel (clipped away, or a crossing
 * that overflowed to NaN) adds nothing.
 */
function paintedExcess(edges: readonly Edge[], rule: Shape["rule"], width: number, height: number): number {
  const [top, bottom] = rowRange(edges, height);
  const active = new ActiveEdges(edges);
  const scan = new ExcessScan(active, rule, width);
  for (let y = top; y < bottom; y += 1) {
    // Rows no edge reaches paint nothing past what the floor charged them, so
    // a shape of two specks a canvas apart is not scanned row by row.
    y = Math.max(y, active.idleUntil(y));
    if (y < bottom) scan.row(y);
  }
  return Math.max(0, scan.visits - edgeSubrows(edges, height)) * sortFactor(edges) + scan.pixels;
}

/** The estimate's scan of one shape: the fill's sub-rows, with the pixels counted, not written. */
class ExcessScan {
  visits = 0;
  pixels = 0;
  private count = 0;
  private min = Infinity;
  private max = -Infinity;

  constructor(
    private readonly active: ActiveEdges,
    private readonly rule: Shape["rule"],
    private readonly width: number,
  ) {}

  private readonly onSpan = (x0: number, x1: number): void => {
    const a = firstPixel(x0);
    const b = lastPixel(x1, this.width);
    if (!(b >= a)) return;
    this.count += b - a + 1;
    this.min = Math.min(this.min, a);
    this.max = Math.max(this.max, b);
  };

  /** Per sub-row, the pixels past the first; per row, the composited extent past its first pixel. */
  row(y: number): void {
    for (let s = 0; s < SUBROWS; s += 1) {
      this.count = 0;
      this.visits += scanSubrow(this.active, y + (s + 0.5) / SUBROWS, this.rule, this.onSpan);
      this.pixels += Math.max(0, this.count - 1);
    }
    this.pixels += this.max >= this.min ? this.max - this.min : 0;
    this.min = Infinity;
    this.max = -Infinity;
  }
}

/**
 * An UPPER BOUND on the scan-conversion work one shape costs, before any row
 * is filled, in the units `PaintStats.work` counts:
 *
 * - every edge is visited on every sub-row it spans, and each sub-row sorts
 *   its crossings — so the edge visits × log₂(edge count);
 * - every sub-row writes the pixels its painted spans reach, and every row
 *   composites from its leftmost touched pixel to its rightmost — at least
 *   one unit each.
 *
 * A filled shape still costs about five units per pixel it covers (four
 * sub-rows and the composite), but a stroke, a frame or a sparse compound
 * path costs the dots it paints, not its bounding box (FUT-2919). Only the
 * part inside the canvas counts, and the charge is never negative or NaN.
 *
 * The estimate's own cost is bounded by the work it charges: the O(edges)
 * {@link scanFloor} comes first, and when it alone exceeds `allowance` that is
 * the answer — already over budget, so the scan that completes the estimate
 * never runs for a document that would be refused anyway. The scan costs no
 * more than the floor it follows, so estimating a whole document never costs
 * more than `MAX_FILL_WORK` units, whatever the document.
 */
function shapeWork({ shape, edges }: Prepared, width: number, height: number, allowance: number): number {
  if (edges.length === 0) return 0;
  const floor = scanFloor(edges, height);
  if (!(floor <= allowance)) return floor;
  return floor + paintedExcess(edges, shape.rule, width, height);
}

/**
 * The upper-bound work of painting `shapes` on a `width` × `height` canvas,
 * while the total is within `MAX_FILL_WORK`; past it, some number past it
 * (the shape that crosses it is not scanned, see `shapeWork`).
 */
export function estimateFillWork(shapes: readonly Shape[], width: number, height: number): number {
  return shapes.reduce(
    (sum, shape) => sum + shapeWork({ shape, edges: edgesOf(shape.polygons) }, width, height, MAX_FILL_WORK - sum),
    0,
  );
}

function paintShape(target: Target, { shape, edges }: Prepared): void {
  if (edges.length === 0) return;
  const [top, bottom] = rowRange(edges, target.height);
  const active = new ActiveEdges(edges);
  const factor = sortFactor(edges);
  let written = 0;
  const onSpan = (x0: number, x1: number): void => {
    written += addCovered(target.row, x0, x1);
  };
  // One sub-row filled, and its work in the estimate's units.
  const subrow = (y: number): number => {
    written = 0;
    const visited = scanSubrow(active, y, shape.rule, onSpan);
    return visited * factor + Math.max(1, written);
  };
  for (let y = top; y < bottom; y += 1) fillRow(target, shape, y, subrow);
}

function fillRow(target: Target, shape: Shape, y: number, subrow: (y: number) => number): void {
  let work = 0;
  for (let s = 0; s < SUBROWS; s += 1) work += subrow(y + (s + 0.5) / SUBROWS);
  work += Math.max(1, compositeRow(target.canvas, target.row, y, shape.rgba));
  target.stats.rowsFilled += 1;
  if (target.stats.work !== undefined) target.stats.work += work;
}

/**
 * Paint shapes in order onto a transparent canvas; straight-alpha RGBA out.
 * Throws `BudgetExceeded` (caught by `rasterizeSvg`) before filling anything
 * when the estimated work is over budget.
 */
export function paint(
  shapes: readonly Shape[],
  width: number,
  height: number,
  budget: Budget,
  stats: PaintStats = { rowsFilled: 0 },
): Uint8ClampedArray {
  // The whole bill is charged before the canvas exists or any row is scanned:
  // a document over budget is refused at the cost of reading its edges once.
  const prepared = shapes.map((shape) => ({ shape, edges: edgesOf(shape.polygons) }));
  for (const entry of prepared) budget.spend(shapeWork(entry, width, height, budget.workLeft));
  const canvas = new Float32Array(width * height * 4);
  const row: Row = { coverage: new Float32Array(width), min: Infinity, max: -Infinity };
  const target: Target = { canvas, row, height, stats };
  for (const entry of prepared) paintShape(target, entry);
  const out = new Uint8ClampedArray(canvas.length);
  for (let o = 0; o < canvas.length; o += 4) {
    const alpha = canvas[o + 3] ?? 0;
    if (alpha <= 0) continue;
    out[o] = Math.round(((canvas[o] ?? 0) / alpha) * 255);
    out[o + 1] = Math.round(((canvas[o + 1] ?? 0) / alpha) * 255);
    out[o + 2] = Math.round(((canvas[o + 2] ?? 0) / alpha) * 255);
    out[o + 3] = Math.round(alpha * 255);
  }
  return out;
}
