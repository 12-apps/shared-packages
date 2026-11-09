import { describe, expect, it } from "vitest";

import { Budget, BudgetExceeded, MAX_FILL_WORK, MAX_RASTER_HEIGHT, MAX_RASTER_WIDTH } from "../budget";
import { estimateFillWork, paint, type PaintStats } from "../fill";
import type { Shape } from "../svg-doc";
import type { Point } from "../svg-path";

/**
 * The fill budget is charged from an ESTIMATE, before any row is scanned, so
 * a refusal costs reading the edges once. These pin the estimate and prove the
 * refusal fills nothing — deterministically, with no clock.
 */

const shape = (polygon: Point[]): Shape => ({ polygons: [polygon], rgba: [0, 0, 0, 255], rule: "nonzero" });
const square = (size: number): Shape => shape([[0, 0], [size, 0], [size, size], [0, size]]);

/** A zigzag of `n` teeth, each edge spanning the full `height`. */
function zigzag(n: number, width: number, height: number): Shape {
  const points: Point[] = [[0, 0]];
  for (let i = 0; i < n; i += 1) points.push([width / 2, height], [0, 0]);
  return shape(points);
}

describe("estimateFillWork", () => {
  it("counts edge sub-rows times the sort factor, plus five units per bounding-box pixel", () => {
    // Two vertical edges x 10 rows x 4 sub-rows = 80 edge visits; log2(4) = 2;
    // plus 10 x 10 pixels x 5.
    expect(estimateFillWork([square(10)], 10, 10)).toBe(80 * 2 + 100 * 5);
  });

  it("counts only the part inside the canvas", () => {
    expect(estimateFillWork([square(1000)], 10, 10)).toBe(estimateFillWork([square(10)], 10, 10));
  });

  it("puts a full-height zigzag of 56 000 edges far over the budget", () => {
    expect(estimateFillWork([zigzag(28_000, 576, 576)], 576, 576)).toBeGreaterThan(MAX_FILL_WORK);
  });

  it("leaves a realistic full-width logo well inside it", () => {
    const logo = Array.from({ length: 40 }, (_, i) => shape([[i * 14, 0], [i * 14 + 12, 0], [i * 14 + 12, 300], [i * 14, 300]]));

    expect(estimateFillWork(logo, 576, 300)).toBeLessThan(MAX_FILL_WORK / 10);
  });
});

describe("paint over budget", () => {
  it("throws before filling a single row", () => {
    const stats: PaintStats = { rowsFilled: 0 };

    expect(() => paint([zigzag(28_000, 576, 576)], 576, 576, new Budget(), stats)).toThrow(BudgetExceeded);
    expect(stats.rowsFilled).toBe(0);
  });

  it("fills every covered row when within budget", () => {
    const stats: PaintStats = { rowsFilled: 0 };

    paint([square(10)], 10, 10, new Budget(), stats);

    expect(stats.rowsFilled).toBe(10);
  });
});

/** Clockwise in device space (y down). */
const box = (x: number, y: number, w: number, h: number): Point[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
/** The same box anticlockwise: a hole under the nonzero rule. */
const hole = (x: number, y: number, w: number, h: number): Point[] => box(x, y, w, h).reverse();
/** A `thickness`-wide stroke from the top-left corner to the bottom-right one, or mirrored. */
function diagonal(thickness: number, width: number, height: number, mirrored = false): Point[] {
  return mirrored
    ? [[width - thickness, 0], [width, 0], [thickness, height], [0, height]]
    : [[0, 0], [thickness, 0], [width, height], [width - thickness, height]];
}

const W = MAX_RASTER_WIDTH;
const H = MAX_RASTER_HEIGHT;

/**
 * A tall, layered store logo on the largest canvas: a background frame
 * (even-odd), a border frame (nonzero, its hole wound the other way), four
 * full-height strokes, four corner-to-corner strokes and a wordmark of four
 * compound paths whose glyphs sit in opposite corners. Ten of its shapes have
 * a bounding box of (nearly) the whole 576 x 2048 canvas though each paints a
 * few dots per row; charged by bounding box, about 5.9M each, it was refused
 * (FUT-2919).
 */
const tallLogo: Shape[] = [
  { polygons: [box(0, 0, W, H), box(6, 6, W - 12, H - 12)], rgba: [0, 0, 0, 255], rule: "evenodd" },
  { polygons: [box(12, 12, W - 24, H - 24), hole(15, 15, W - 30, H - 30)], rgba: [0, 0, 0, 255], rule: "nonzero" },
  ...[100, 200, 376, 476].map((x) => shape(box(x, 0, 4, H))),
  ...[4, 8].flatMap((thickness) => [shape(diagonal(thickness, W, H)), shape(diagonal(thickness, W, H, true))]),
  ...[0, 1, 2, 3].map((i): Shape => ({
    polygons: [box(4 + i * 10, 4, 6, 20), box(W - 10 - i * 10, H - 24, 6, 20), box(200 + i * 40, 1000, 30, 40)],
    rgba: [0, 0, 0, 255],
    rule: "nonzero",
  })),
];

/** `count` filled shapes that each cover the whole canvas. */
const fullCanvasStack = (count: number): Shape[] => Array.from({ length: count }, () => shape(box(0, 0, W, H)));

describe("estimateFillWork on a tall canvas (FUT-2919)", () => {
  it("charges a tall thin-stroke logo for the dots it paints, not its bounding boxes", () => {
    expect(estimateFillWork(tallLogo, W, H)).toBeLessThan(MAX_FILL_WORK / 10);
  });

  it("paints the tall logo instead of refusing it", () => {
    const stats: PaintStats = { rowsFilled: 0 };

    expect(() => paint(tallLogo, W, H, new Budget(), stats)).not.toThrow();
    // Every row of every shape: nine span all 2048, the border 2024, each wordmark path 2040.
    expect(stats.rowsFilled).toBe(9 * H + 2024 + 4 * 2040);
  });

  it("still charges a filled full-canvas shape five units per pixel, so eight fit and nine are refused", () => {
    expect(estimateFillWork(fullCanvasStack(1), W, H)).toBeGreaterThanOrEqual(W * H * 5);
    expect(estimateFillWork(fullCanvasStack(8), W, H)).toBeLessThanOrEqual(MAX_FILL_WORK);
    expect(estimateFillWork(fullCanvasStack(9), W, H)).toBeGreaterThan(MAX_FILL_WORK);
  });

  it("refuses a stack of full-canvas shapes before filling a single row", () => {
    const stats: PaintStats = { rowsFilled: 0 };

    expect(() => paint(fullCanvasStack(9), W, H, new Budget(), stats)).toThrow(BudgetExceeded);
    expect(stats.rowsFilled).toBe(0);
  });

  it("charges a pixel-aligned one-dot stroke no more than its bounding box was", () => {
    // Two edges x 2048 rows x 4 sub-rows x log2(4), plus five units per row of one dot: a span
    // ending on a pixel boundary is not charged for the pixel after it.
    expect(estimateFillWork([shape(box(10, 0, 1, H))], W, H)).toBe(2 * H * 4 * 2 + H * 5);
  });

  it("refuses the tall logo stacked on full-canvas shapes", () => {
    expect(() => paint([...fullCanvasStack(8), ...tallLogo], W, H, new Budget())).toThrow(BudgetExceeded);
  });
});

describe("estimateFillWork is an upper bound on the work paint does", () => {
  /** A five-point star drawn in one stroke: its centre is wound twice. */
  const star: Point[] = Array.from({ length: 5 }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    return [50 + 45 * Math.cos(angle), 50 + 45 * Math.sin(angle)] as Point;
  });
  const samples: [string, Shape][] = [
    ["a concave L", shape([[5, 5], [60, 5], [60, 20], [20, 20], [20, 90], [5, 90]])],
    ["a self-overlapping star, nonzero", shape(star)],
    ["a self-overlapping star, even-odd", { ...shape(star), rule: "evenodd" }],
    ["a frame with a hole, even-odd", { polygons: [box(2, 2, 90, 90), box(10, 10, 74, 74)], rgba: [0, 0, 0, 255], rule: "evenodd" }],
    ["a frame with a hole, nonzero", { polygons: [box(2, 2, 90, 90), hole(10, 10, 74, 74)], rgba: [0, 0, 0, 255], rule: "nonzero" }],
    ["two overlapping boxes, nonzero", { polygons: [box(10, 10, 50, 50), box(30, 30, 50, 50)], rgba: [0, 0, 0, 255], rule: "nonzero" }],
    ["a shape clipped on every side", shape([[-50, -40], [160, 30], [130, 170], [-20, 120]])],
    ["fractional, sub-row-thin slivers", shape([[3.3, 7.12], [90.7, 7.38], [4.1, 7.38]])],
    ["a thin diagonal", shape(diagonal(2.5, 100, 100))],
    ["coordinates far outside the canvas", shape([[-1e12, -1e12], [1e12, -1e12], [1e12, 1e12], [-1e12, 1e12]])],
  ];

  it.each(samples)("on %s", (_label, sample) => {
    const stats: PaintStats = { rowsFilled: 0, work: 0 };

    paint([sample], 100, 100, new Budget(), stats);

    expect(stats.work).toBeGreaterThan(0);
    expect(estimateFillWork([sample], 100, 100)).toBeGreaterThanOrEqual(stats.work ?? Infinity);
  });

  it("on the tall logo, shape by shape", () => {
    for (const sample of tallLogo) {
      const stats: PaintStats = { rowsFilled: 0, work: 0 };

      paint([sample], W, H, new Budget(), stats);

      expect(stats.work).toBeGreaterThan(0);
      expect(estimateFillWork([sample], W, H)).toBeGreaterThanOrEqual(stats.work ?? Infinity);
    }
  });
});

describe("estimateFillWork on degenerate shapes", () => {
  it("charges nothing for a shape entirely outside the canvas", () => {
    expect(estimateFillWork([shape(box(200, 200, 10, 10)), shape(box(-30, -30, 10, 10))], 100, 100)).toBe(0);
  });

  it("charges nothing for a shape with no height", () => {
    expect(estimateFillWork([shape([[0, 5], [50, 5], [90, 5]])], 100, 100)).toBe(0);
  });

  it("charges a box with huge coordinates as the canvas it covers", () => {
    const huge = shape([[-1e300, -1e300], [1e300, -1e300], [1e300, 1e300], [-1e300, 1e300]]);

    expect(estimateFillWork([huge], 100, 100)).toBe(estimateFillWork([square(100)], 100, 100));
  });

  it("stays finite and non-negative when an edge has a non-finite coordinate", () => {
    const poisoned = shape([[0, 0], [Infinity, 50], [NaN, 100], [0, 100]]);
    const work = estimateFillWork([poisoned], 100, 100);

    expect(Number.isFinite(work)).toBe(true);
    expect(work).toBeGreaterThanOrEqual(0);
  });
});
