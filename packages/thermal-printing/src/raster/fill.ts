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
import { chargeAll } from "./estimate";
import {
  ActiveEdges,
  SUBROWS,
  edgesOf,
  firstPixel,
  lastPixel,
  rowRange,
  scanSubrow,
  sortFactor,
  type PaintStats,
  type Prepared,
} from "./scan";
import type { Shape } from "./svg-doc";

export { estimateFillWork } from "./estimate";
export type { PaintStats } from "./scan";

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

/** A reusable coverage row, and the pixel range the current row has touched. */
interface Row {
  coverage: Float32Array;
  min: number;
  max: number;
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

interface Target {
  canvas: Float32Array;
  row: Row;
  height: number;
  stats: PaintStats;
}

function paintShape(target: Target, { shape, edges }: Prepared): void {
  if (edges.length === 0) return;
  const [top, bottom] = rowRange(edges, target.height);
  const active = new ActiveEdges(edges);
  const factor = sortFactor(edges);
  let written = 0;
  const onSpan = (x0: number, x1: number): void => {
    // Crossings are finite (see `crossingX` in ./scan), so a count is too;
    // the counter still refuses a non-finite one, so it can never turn NaN.
    const count = addCovered(target.row, x0, x1);
    if (Number.isFinite(count)) written += count;
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
  // The whole bill is charged before the canvas exists or any row is filled;
  // see `chargeAll` for what a refusal costs.
  const prepared = shapes.map((shape) => ({ shape, edges: edgesOf(shape.polygons) }));
  chargeAll(prepared, width, height, budget, stats);
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
