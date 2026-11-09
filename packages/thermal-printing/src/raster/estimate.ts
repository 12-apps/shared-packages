/**
 * The fill budget's estimate: what painting a document will cost, charged
 * before anything is filled, in the units `PaintStats.work` counts.
 */
import { Budget, MAX_FILL_WORK } from "./budget";
import {
  ActiveEdges,
  SUBROWS,
  edgesOf,
  firstPixel,
  lastPixel,
  rowRange,
  scanSubrow,
  sortFactor,
  type Edge,
  type PaintStats,
  type Prepared,
} from "./scan";
import type { Shape } from "./svg-doc";

/** The least `m` whose sub-row sample `(m + 0.5) / SUBROWS` lies at or after `y`. */
function firstSample(y: number): number {
  // The closed form, then corrected with the very comparison the scan makes,
  // so a rounding in it can never miscount a sample.
  let m = Math.ceil(y * SUBROWS - 0.5);
  while ((m - 0.5) / SUBROWS >= y) m -= 1;
  while ((m + 0.5) / SUBROWS < y) m += 1;
  return m;
}

/**
 * Σ over edges of the sub-row samples each one is visited on inside the
 * canvas — exactly the visits the scan makes, counted in O(1) per edge.
 */
const edgeVisits = (edges: readonly Edge[], height: number): number =>
  edges.reduce((sum, e) => {
    const [from, to] = [Math.max(e.y0, 0), Math.min(e.y1, height)];
    return to > from ? sum + firstSample(to) - firstSample(from) : sum;
  }, 0);

/**
 * The leftmost and rightmost x a crossing of any edge can land on. A crossing
 * is `x0 + t × (x1 - x0)` with 0 <= t < 1, so it never passes the edge's top
 * end `x0`, but the rounded difference can carry it a few ulps past the bottom
 * end `x1` (and, for an edge 1e300 long, a long way past it): that side is
 * widened by far more than the error. A vertical edge's crossing is exact.
 */
function columnRange(edges: readonly Edge[]): [number, number] {
  let [left, right] = [Infinity, -Infinity];
  for (const e of edges) {
    const slack = 1e-9 * Math.max(1, Math.abs(e.x0), Math.abs(e.x1));
    const [x1Low, x1High] = e.x1 === e.x0 ? [e.x1, e.x1] : [e.x1 - slack, e.x1 + slack];
    left = Math.min(left, e.x0, x1Low);
    right = Math.max(right, e.x0, x1High);
  }
  return [left, right];
}

/**
 * How one shape is charged, decided in O(edges) before any sub-row is scanned.
 *
 * Three numbers, each in the units `PaintStats.work` counts:
 *
 * - `floor`, what the fill costs however little it paints: every edge visit
 *   times the sort factor, plus one unit per sub-row and one per row;
 * - `scanCost`, what scanning the shape to count its painted spans costs: the
 *   same edge visits, plus one unit per sub-row;
 * - `box`, an upper bound on the fill from the bounding box alone: the edge
 *   visits, plus five units per pixel of each row's columns (at least one).
 *   Two spans of one sub-row may share a pixel, at most ⌊a/2⌋ − 1 times for
 *   the a edges it visits, and ⌊a/2⌋ − 1 ≤ a × (1/2 − 1/edges) for a ≤ edges;
 *   so each visit is also charged (1/2 − 1/edges) of a pixel. A crossing whose
 *   x overflows breaks that argument, so a shape with such an edge has no box
 *   bound and is always scanned.
 *
 * The shape is scanned only when that can save at least half of `box`; a
 * stroke, a small or a filled shape is charged `box` and never scanned. A
 * scanned shape is charged `scanCost` on top of what it paints, so estimating
 * and filling a document together never exceed `MAX_FILL_WORK`.
 */
interface Plan {
  entry: Prepared;
  floor: number;
  scanCost: number;
  box: number;
  scan: boolean;
  /** What the shape costs at least, in O(edges): `box` when not scanned, else `floor + scanCost`. */
  lower: number;
}

function planShape(entry: Prepared, width: number, height: number): Plan {
  const { edges } = entry;
  if (edges.length === 0) return { entry, floor: 0, scanCost: 0, box: 0, scan: false, lower: 0 };
  const [top, bottom] = rowRange(edges, height);
  const rows = bottom - top;
  const factor = sortFactor(edges);
  const visits = edgeVisits(edges, height);
  const floor = visits * factor + rows * (SUBROWS + 1);
  const scanCost = visits * factor + rows * SUBROWS;
  const [left, right] = columnRange(edges);
  const columns = Math.max(1, Math.ceil(Math.min(right, width)) - Math.floor(Math.max(left, 0)));
  const shared = Math.max(0, 1 / 2 - 1 / edges.length);
  const bounded = edges.every((e) => Number.isFinite(e.x1 - e.x0));
  const box = bounded ? visits * (factor + shared) + rows * columns * (SUBROWS + 1) : Infinity;
  const scan = box > 2 * (floor + scanCost);
  return { entry, floor, scanCost, box, scan, lower: scan ? floor + scanCost : box };
}

/**
 * What a shape is charged, an UPPER BOUND on the work its fill does plus the
 * work this estimate does on it (see {@link Plan}). A scanned shape's painted
 * pixels are counted by {@link paintedExcess}, unless `allowance` cannot even
 * take its `lower` — then that is the answer, already over budget.
 */
function charge(plan: Plan, width: number, height: number, allowance: number, stats: PaintStats): number {
  if (!plan.scan) return plan.box;
  if (!(plan.lower <= allowance)) return plan.lower;
  const { shape, edges } = plan.entry;
  const excess = paintedExcess(edges, shape.rule, width, height, stats);
  return plan.scanCost + Math.min(plan.box, plan.floor + excess);
}

/**
 * The rest of a scanned shape's fill past its `floor`, by scanning its
 * sub-rows exactly as the fill will, but counting the pixels each painted
 * span reaches instead of writing them: per sub-row, the pixels past the
 * first; per row, the composited extent past its first pixel.
 *
 * Its own cost is the edge visits and sub-rows `scanCost` charges, each span
 * counted in O(1): linear in edges × sub-rows spanned, never in the pixel
 * area. Rows no edge reaches are skipped. A span with a NaN end (a crossing
 * whose x overflowed) is not counted; the fill writes no pixel for it either.
 */
function paintedExcess(
  edges: readonly Edge[],
  rule: Shape["rule"],
  width: number,
  height: number,
  stats: PaintStats,
): number {
  const [top, bottom] = rowRange(edges, height);
  const active = new ActiveEdges(edges);
  const scan = new ExcessScan(active, rule, width);
  for (let y = top; y < bottom; y += 1) {
    // Rows no edge reaches paint nothing past what the floor charged them, so
    // a shape of two specks a canvas apart is not scanned row by row.
    y = Math.max(y, active.idleUntil(y));
    if (y < bottom) scan.row(y);
  }
  const factor = sortFactor(edges);
  if (stats.scanWork !== undefined) stats.scanWork += scan.visits * factor + scan.subrows;
  return Math.max(0, scan.visits - edgeVisits(edges, height)) * factor + scan.pixels;
}

/** The estimate's scan of one shape: the fill's sub-rows, with the pixels counted, not written. */
class ExcessScan {
  visits = 0;
  subrows = 0;
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
    this.subrows += SUBROWS;
    this.pixels += this.max >= this.min ? this.max - this.min : 0;
    this.min = Infinity;
    this.max = -Infinity;
  }
}

/**
 * Charge every shape of a document to `budget`, before anything is filled.
 *
 * First the O(edges) `lower` of every shape: a document over budget on those
 * alone is refused having read its edges once, and nothing is scanned. Then
 * each shape's {@link charge}, in order. Throws `BudgetExceeded`.
 */
export function chargeAll(prepared: readonly Prepared[], width: number, height: number, budget: Budget, stats: PaintStats): void {
  const plans = prepared.map((entry) => planShape(entry, width, height));
  const lower = new Budget();
  for (const plan of plans) lower.spend(plan.lower);
  for (const plan of plans) budget.spend(charge(plan, width, height, budget.workLeft, stats));
}

/**
 * The upper-bound work of painting `shapes` on a `width` × `height` canvas,
 * the estimate's own scans included, while the total is within
 * `MAX_FILL_WORK`; past it, some number past it (the shapes left are not
 * scanned). `stats.scanWork`, when present, is added the scans' own work.
 */
export function estimateFillWork(
  shapes: readonly Shape[],
  width: number,
  height: number,
  stats: PaintStats = { rowsFilled: 0 },
): number {
  const plans = shapes.map((shape) => planShape({ shape, edges: edgesOf(shape.polygons) }, width, height));
  const lower = plans.reduce((sum, plan) => sum + plan.lower, 0);
  if (!(lower <= MAX_FILL_WORK)) return lower;
  return plans.reduce((sum, plan) => sum + charge(plan, width, height, MAX_FILL_WORK - sum, stats), 0);
}
