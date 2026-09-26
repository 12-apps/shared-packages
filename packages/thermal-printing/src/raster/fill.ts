/**
 * Scan conversion: filled polygons to anti-aliased RGBA, in plain arithmetic.
 *
 * Each pixel row is sampled at {@link SUBROWS} heights; along each sub-row the
 * spans inside the shape are accumulated with EXACT horizontal coverage, so an
 * edge pixel gets the fraction of it the shape covers. The coverage then
 * composites the shape's colour over what is already there, painter's order,
 * which is how SVG paints.
 */
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

function fillSubrow(row: Float32Array, edges: readonly Edge[], y: number, rule: Shape["rule"]): void {
  let winding = 0;
  let start = 0;
  for (const { x, dir } of crossings(edges, y)) {
    const wasInside = rule === "evenodd" ? winding % 2 !== 0 : winding !== 0;
    winding += rule === "evenodd" ? 1 : dir;
    const isInside = rule === "evenodd" ? winding % 2 !== 0 : winding !== 0;
    if (!wasInside && isInside) start = x;
    else if (wasInside && !isInside) addSpan(row, start, x, 1 / SUBROWS);
  }
}

/** Composite one row's coverage of `shape` into the premultiplied canvas. */
function compositeRow(canvas: Float32Array, row: Float32Array, y: number, rgba: Shape["rgba"]): void {
  const width = row.length;
  const [r, g, b, a] = [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255];
  row.forEach((coverage, x) => {
    if (coverage <= 0) return;
    const alpha = Math.min(1, coverage) * a;
    const o = (y * width + x) * 4;
    canvas[o] = r * alpha + (canvas[o] ?? 0) * (1 - alpha);
    canvas[o + 1] = g * alpha + (canvas[o + 1] ?? 0) * (1 - alpha);
    canvas[o + 2] = b * alpha + (canvas[o + 2] ?? 0) * (1 - alpha);
    canvas[o + 3] = alpha + (canvas[o + 3] ?? 0) * (1 - alpha);
  });
}

function fillRow(canvas: Float32Array, width: number, y: number, shape: Shape, edges: readonly Edge[]): void {
  const row = new Float32Array(width);
  for (let s = 0; s < SUBROWS; s += 1) fillSubrow(row, edges, y + (s + 0.5) / SUBROWS, shape.rule);
  compositeRow(canvas, row, y, shape.rgba);
}

function paintShape(canvas: Float32Array, width: number, height: number, shape: Shape): void {
  const edges = edgesOf(shape.polygons);
  if (edges.length === 0) return;
  const top = Math.max(0, Math.floor(Math.min(...edges.map((e) => e.y0))));
  const bottom = Math.min(height, Math.ceil(Math.max(...edges.map((e) => e.y1))));
  for (let y = top; y < bottom; y += 1) fillRow(canvas, width, y, shape, edges);
}

/** Paint shapes in order onto a transparent canvas; straight-alpha RGBA out. */
export function paint(shapes: readonly Shape[], width: number, height: number): Uint8ClampedArray {
  const canvas = new Float32Array(width * height * 4);
  for (const shape of shapes) paintShape(canvas, width, height, shape);
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
