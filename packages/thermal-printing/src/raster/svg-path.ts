/**
 * SVG path data to polygons, in device space.
 *
 * Curves are flattened AFTER the transform, into segments about a dot long, so
 * the polygon's accuracy is set in printer dots rather than in whatever units
 * the artwork happened to be drawn in. Béziers survive an affine transform, so
 * their control points are mapped and the curve flattened in dots; an arc does
 * not (a rotated, scaled ellipse is still an ellipse, but not an axis-aligned
 * one), so it is sampled in user space at a step derived from its size in dots.
 */

/** `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export type Point = readonly [number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, [x, y]: Point): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** How many dots one user unit spans, on average, under `m`. */
function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

const distance = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Segments for a curve whose control polygon is `length` dots long: about one per dot. */
const segmentsFor = (length: number): number => Math.min(256, Math.max(2, Math.ceil(length)));

function cubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  const n = segmentsFor(distance(p0, p1) + distance(p1, p2) + distance(p2, p3));
  const out: Point[] = [];
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

/** Scanner over path data: numbers, and arc flags that may be run together. */
class Scanner {
  private index = 0;
  constructor(private readonly source: string) {}

  private skip(): void {
    while (this.index < this.source.length && /[\s,]/.test(this.source[this.index] ?? "")) this.index += 1;
  }

  command(): string | null {
    this.skip();
    const char = this.source[this.index];
    if (char !== undefined && /[MmLlHhVvCcSsQqTtAaZz]/.test(char)) {
      this.index += 1;
      return char;
    }
    return null;
  }

  hasNumber(): boolean {
    this.skip();
    return /[-+.\d]/.test(this.source[this.index] ?? "");
  }

  number(): number {
    this.skip();
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(this.source.slice(this.index));
    if (match === null) throw new SyntaxError("path data");
    this.index += match[0].length;
    return Number(match[0]);
  }

  flag(): boolean {
    this.skip();
    const char = this.source[this.index];
    if (char !== "0" && char !== "1") throw new SyntaxError("arc flag");
    this.index += 1;
    return char === "1";
  }

  done(): boolean {
    this.skip();
    return this.index >= this.source.length;
  }
}

/** The pen, in USER space; points are emitted in device space. */
interface Pen {
  m: Matrix;
  scale: number;
  current: Point;
  start: Point;
  /** The last control point, reflected by S/s and T/t. */
  control: Point | null;
  subpath: Point[];
  subpaths: Point[][];
}

function moveTo(pen: Pen, to: Point): void {
  if (pen.subpath.length > 1) pen.subpaths.push(pen.subpath);
  pen.subpath = [apply(pen.m, to)];
  pen.current = to;
  pen.start = to;
}

function lineTo(pen: Pen, to: Point): void {
  pen.subpath.push(apply(pen.m, to));
  pen.current = to;
}

function cubicTo(pen: Pen, c1: Point, c2: Point, to: Point): void {
  const points = cubic(apply(pen.m, pen.current), apply(pen.m, c1), apply(pen.m, c2), apply(pen.m, to));
  pen.subpath.push(...points);
  pen.current = to;
  pen.control = c2;
}

function quadTo(pen: Pen, c: Point, to: Point): void {
  const from = pen.current;
  const c1: Point = [from[0] + (2 / 3) * (c[0] - from[0]), from[1] + (2 / 3) * (c[1] - from[1])];
  const c2: Point = [to[0] + (2 / 3) * (c[0] - to[0]), to[1] + (2 / 3) * (c[1] - to[1])];
  cubicTo(pen, c1, c2, to);
  pen.control = c;
}

const reflect = (pen: Pen): Point =>
  pen.control === null ? pen.current : [2 * pen.current[0] - pen.control[0], 2 * pen.current[1] - pen.control[1]];

/** An arc in centre form: centre, radii, rotation, start angle and sweep. */
interface CentreArc {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  cos: number;
  sin: number;
  theta: number;
  delta: number;
}

/** Normalise the sweep so it runs the way the flag says. */
function sweepAngle(delta: number, sweep: boolean): number {
  if (sweep && delta < 0) return delta + 2 * Math.PI;
  if (!sweep && delta > 0) return delta - 2 * Math.PI;
  return delta;
}

/** The endpoint form of an arc converted to centre form (SVG 1.1 §F.6.5). */
function centreArc(from: Point, to: Point, radii: Point, rotation: number, large: boolean, sweep: boolean): CentreArc {
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  // Radii too small to reach the endpoint are scaled up until they just do.
  const [r0, r1] = [Math.abs(radii[0]), Math.abs(radii[1])];
  const lambda = Math.max(1, Math.sqrt((xp * xp) / (r0 * r0) + (yp * yp) / (r1 * r1)));
  const [rx, ry] = [r0 * lambda, r1 * lambda];
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const theta = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
  const delta = sweepAngle(Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - theta, sweep);
  return {
    cx: cos * cxp - sin * cyp + (from[0] + to[0]) / 2,
    cy: sin * cxp + cos * cyp + (from[1] + to[1]) / 2,
    rx,
    ry,
    cos,
    sin,
    theta,
    delta,
  };
}

function arcTo(pen: Pen, radii: Point, rotation: number, large: boolean, sweep: boolean, to: Point): void {
  const degenerate = radii[0] === 0 || radii[1] === 0 || (pen.current[0] === to[0] && pen.current[1] === to[1]);
  if (degenerate) return lineTo(pen, to);
  const { cx, cy, rx, ry, cos, sin, theta, delta } = centreArc(pen.current, to, radii, rotation, large, sweep);
  const steps = segmentsFor(Math.abs(delta) * Math.max(rx, ry) * pen.scale);
  for (let i = 1; i <= steps; i += 1) {
    const angle = theta + (delta * i) / steps;
    const [ex, ey] = [rx * Math.cos(angle), ry * Math.sin(angle)];
    pen.subpath.push(apply(pen.m, [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]));
  }
  pen.current = to;
}

type Handler = (pen: Pen, s: Scanner, rel: boolean) => void;

const at = (pen: Pen, rel: boolean, x: number, y: number): Point =>
  rel ? [pen.current[0] + x, pen.current[1] + y] : [x, y];

const HANDLERS: Readonly<Record<string, Handler>> = {
  m: (pen, s, rel) => moveTo(pen, at(pen, rel, s.number(), s.number())),
  l: (pen, s, rel) => lineTo(pen, at(pen, rel, s.number(), s.number())),
  h: (pen, s, rel) => lineTo(pen, [(rel ? pen.current[0] : 0) + s.number(), pen.current[1]]),
  v: (pen, s, rel) => lineTo(pen, [pen.current[0], (rel ? pen.current[1] : 0) + s.number()]),
  c: (pen, s, rel) => {
    const c1 = at(pen, rel, s.number(), s.number());
    const c2 = at(pen, rel, s.number(), s.number());
    cubicTo(pen, c1, c2, at(pen, rel, s.number(), s.number()));
  },
  s: (pen, s, rel) => {
    const c1 = reflect(pen);
    const c2 = at(pen, rel, s.number(), s.number());
    cubicTo(pen, c1, c2, at(pen, rel, s.number(), s.number()));
  },
  q: (pen, s, rel) => {
    const c = at(pen, rel, s.number(), s.number());
    quadTo(pen, c, at(pen, rel, s.number(), s.number()));
  },
  t: (pen, s, rel) => quadTo(pen, reflect(pen), at(pen, rel, s.number(), s.number())),
  a: (pen, s, rel) => {
    const radii: Point = [s.number(), s.number()];
    const rotation = s.number();
    const large = s.flag();
    const sweep = s.flag();
    arcTo(pen, radii, rotation, large, sweep, at(pen, rel, s.number(), s.number()));
  },
};

/** Commands whose control point the NEXT smooth command may reflect. */
const KEEPS_CONTROL = new Set(["c", "s", "q", "t"]);

function runCommand(pen: Pen, scanner: Scanner, command: string): void {
  const key = command.toLowerCase();
  const rel = command !== command.toUpperCase();
  if (key === "z") {
    pen.subpath.push(apply(pen.m, pen.start));
    moveTo(pen, pen.start);
    return;
  }
  const handler = HANDLERS[key];
  if (handler === undefined) return;
  let first = true;
  do {
    // Pairs after a moveto are implicit linetos, relative if the moveto was.
    const run = key === "m" && !first ? (HANDLERS.l as Handler) : handler;
    if (!KEEPS_CONTROL.has(key)) pen.control = null;
    run(pen, scanner, rel);
    first = false;
  } while (scanner.hasNumber());
}

/**
 * Parse path data into closed polygons in device space.
 *
 * Malformed data keeps what was drawn before the error — the renderer's
 * behaviour the SVG specification asks for — rather than throwing the whole
 * picture away.
 */
export function pathToPolygons(d: string, m: Matrix): Point[][] {
  const pen: Pen = { m, scale: scaleOf(m), current: [0, 0], start: [0, 0], control: null, subpath: [], subpaths: [] };
  const scanner = new Scanner(d);
  try {
    while (!scanner.done()) {
      const command = scanner.command();
      if (command === null) break;
      runCommand(pen, scanner, command);
    }
  } catch {
    // Keep what was drawn so far.
  }
  if (pen.subpath.length > 1) pen.subpaths.push(pen.subpath);
  return pen.subpaths;
}
