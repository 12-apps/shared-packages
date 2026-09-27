/**
 * Scan conversion: filled polygons to anti-aliased RGBA, in plain arithmetic.
 *
 * Each pixel row is sampled at {@link SUBROWS} heights; along each sub-row the
 * spans inside the shape are accumulated with EXACT horizontal coverage, so an
 * edge pixel gets the fraction of it the shape covers. The coverage then
 * composites the shape's colour over what is already there, painter's order,
 * which is how SVG paints.
 */
import type { Budget } from "./budget";
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

  at(y: number): Edge[] {
    while (this.next < this.sorted.length && (this.sorted[this.next]?.y0 ?? Infinity) <= y) {
      this.active.push(this.sorted[this.next] as Edge);
      this.next += 1;
    }
    this.active = this.active.filter((edge) => edge.y1 > y);
    return this.active;
  }
}

/** Add `weight` × the covered fraction of each pixel in [x0, x1) to `row`. */
function addSpan(row: Float32Array, x0: number, x1: number, weight: number): void {
  const a = Math.max(0, x0);
  const b = Math.min(row.length, x1);
  if (b <= a) return;
  const i0 = Math.floor(a);
  const i1 = Math.floor(b);
  if (i0 === i1) {
    row[i0] = (row[i0] ?? 0) + (b - a) * weight;
    return;
  }
  row[i0] = (row[i0] ?? 0) + (i0 + 1 - a) * weight;
  for (let i = i0 + 1; i < i1; i += 1) row[i] = (row[i] ?? 0) + weight;
  if (i1 < row.length) row[i1] = (row[i1] ?? 0) + (b - i1) * weight;
}

/** A reusable coverage row, and the pixel range the current row has touched. */
interface Row {
  coverage: Float32Array;
  min: number;
  max: number;
}

function fillSubrow(row: Row, active: ActiveEdges, y: number, rule: Shape["rule"]): void {
  const edges = active.at(y);
  let winding = 0;
  let start = 0;
  for (const { x, dir } of crossings(edges, y)) {
    const wasInside = rule === "evenodd" ? winding % 2 !== 0 : winding !== 0;
    winding += rule === "evenodd" ? 1 : dir;
    const isInside = rule === "evenodd" ? winding % 2 !== 0 : winding !== 0;
    if (!wasInside && isInside) start = x;
    else if (wasInside && !isInside) addCovered(row, start, x);
  }
}

function addCovered(row: Row, x0: number, x1: number): void {
  const a = Math.max(0, Math.floor(x0));
  const b = Math.min(row.coverage.length - 1, Math.floor(x1));
  if (b < a) return;
  row.min = Math.min(row.min, a);
  row.max = Math.max(row.max, b);
  addSpan(row.coverage, x0, x1, 1 / SUBROWS);
}

/**
 * Composite one row's coverage of `shape` into the premultiplied canvas —
 * only across the pixels the shape touched on this row, and clear them for the
 * next row as it goes. A small shape on a wide canvas costs its own width.
 */
function compositeRow(canvas: Float32Array, row: Row, y: number, rgba: Shape["rgba"]): void {
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
  row.min = Infinity;
  row.max = -Infinity;
}

/** Counters a caller (a test) can pass to `paint` to see what it did. */
export interface PaintStats {
  rowsFilled: number;
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

/**
 * An UPPER BOUND on the scan-conversion work one shape costs, from its edges
 * alone, before any row is scanned:
 *
 * - every edge is visited on every sub-row it spans, and each sub-row sorts
 *   its crossings — so Σ(sub-rows spanned) × log₂(edge count);
 * - every pixel of the shape's bounding box may be touched on every sub-row
 *   and composited once per row — so rows × width × (SUBROWS + 1).
 *
 * Only the part inside the canvas counts. The real work is never more than
 * this, so charging the estimate up front lets the budget refuse a document
 * before it has filled a single row, instead of partway through.
 */
function shapeWork(edges: readonly Edge[], width: number, height: number): number {
  if (edges.length === 0) return 0;
  const sortFactor = Math.ceil(Math.log2(edges.length + 2));
  let subrows = 0;
  let [top, bottom, left, right] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const e of edges) {
    subrows += Math.max(0, Math.min(e.y1, height) - Math.max(e.y0, 0)) * SUBROWS;
    [top, bottom] = [Math.min(top, e.y0), Math.max(bottom, e.y1)];
    [left, right] = [Math.min(left, e.x0, e.x1), Math.max(right, e.x0, e.x1)];
  }
  const rows = Math.max(0, Math.ceil(Math.min(bottom, height)) - Math.floor(Math.max(top, 0)));
  const columns = Math.max(0, Math.ceil(Math.min(right, width)) - Math.floor(Math.max(left, 0)));
  return subrows * sortFactor + rows * columns * (SUBROWS + 1);
}

/** The upper-bound work of painting `shapes` on a `width` × `height` canvas. */
export function estimateFillWork(shapes: readonly Shape[], width: number, height: number): number {
  return shapes.reduce((sum, shape) => sum + shapeWork(edgesOf(shape.polygons), width, height), 0);
}

function paintShape(target: Target, { shape, edges }: Prepared): void {
  if (edges.length === 0) return;
  // A reduce, not Math.min(...spread): a spread of a huge path overflows the stack.
  const top = Math.max(0, Math.floor(edges.reduce((m, e) => Math.min(m, e.y0), Infinity)));
  const bottom = Math.min(target.height, Math.ceil(edges.reduce((m, e) => Math.max(m, e.y1), -Infinity)));
  const active = new ActiveEdges(edges);
  for (let y = top; y < bottom; y += 1) fillRow(target, shape, active, y);
}

function fillRow(target: Target, shape: Shape, active: ActiveEdges, y: number): void {
  for (let s = 0; s < SUBROWS; s += 1) fillSubrow(target.row, active, y + (s + 0.5) / SUBROWS, shape.rule);
  compositeRow(target.canvas, target.row, y, shape.rgba);
  target.stats.rowsFilled += 1;
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
  for (const { edges } of prepared) budget.spend(shapeWork(edges, width, height));
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
