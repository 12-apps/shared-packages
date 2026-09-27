import { describe, expect, it } from "vitest";

import { Budget, BudgetExceeded, MAX_FILL_WORK } from "../budget";
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
