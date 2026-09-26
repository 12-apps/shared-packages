/**
 * The part of an SVG document a flat-colour mark uses: shapes, fills,
 * transforms, groups. Everything else is named in `unsupported` rather than
 * guessed at — see `rasterizeSvg` for why that boundary is where it is.
 */
import { IDENTITY, multiply, pathToPolygons, type Matrix, type Point } from "./svg-path";
import { scanAttributes, scanFunctions } from "./xml";

/** A filled shape, ready to scan-convert. */
export interface Shape {
  polygons: Point[][];
  /** Straight RGBA, 0-255, alpha already multiplied by every opacity above it. */
  rgba: readonly [number, number, number, number];
  rule: "nonzero" | "evenodd";
}

export interface Paint {
  fill: readonly [number, number, number] | null;
  fillOpacity: number;
  opacity: number;
  rule: "nonzero" | "evenodd";
  m: Matrix;
}

export const DEFAULT_PAINT: Paint = { fill: [0, 0, 0], fillOpacity: 1, opacity: 1, rule: "nonzero", m: IDENTITY };

export type Attributes = Readonly<Record<string, string>>;

export function parseAttributes(source: string): Attributes {
  const out = scanAttributes(source);
  // `style="fill:#000"` wins over the attribute, as the cascade says it does.
  for (const declaration of (out.style ?? "").split(";")) {
    const [name, value] = declaration.split(":").map((part) => part.trim());
    if (name && value) out[name] = value;
  }
  return out;
}

const NAMED: Readonly<Record<string, readonly [number, number, number]>> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  currentcolor: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
};

function parseHex(hex: string): readonly [number, number, number] | undefined {
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
  if (!/^[\da-f]{6}$/i.test(full)) return undefined;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function parseRgb(body: string): readonly [number, number, number] | undefined {
  const parts = body.split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  if (parts.length < 3) return undefined;
  const channel = (part: string): number =>
    part.endsWith("%") ? (parseFloat(part) * 255) / 100 : parseFloat(part);
  const [r = 0, g = 0, b = 0] = parts.map(channel);
  return [r, g, b];
}

/**
 * A fill value: a colour, `none` (null), or `undefined` when it is a paint this
 * rasteriser cannot draw (a gradient, a pattern) — the caller reports that.
 */
function parseColour(value: string): readonly [number, number, number] | null | undefined {
  const v = value.trim().toLowerCase();
  if (v === "none" || v === "transparent") return null;
  if (v.startsWith("#")) return parseHex(v.slice(1));
  if ((v.startsWith("rgb(") || v.startsWith("rgba(")) && v.endsWith(")")) {
    return parseRgb(v.slice(v.indexOf("(") + 1, -1));
  }
  return NAMED[v];
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

function rotation(degrees: number, cx: number, cy: number): Matrix {
  const [cos, sin] = [Math.cos(toRadians(degrees)), Math.sin(toRadians(degrees))];
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

/** Each transform function, from its argument list (missing ones read as the specification's defaults). */
const TRANSFORMS: Readonly<Record<string, (n: number[]) => Matrix>> = {
  matrix: ([a = 1, b = 0, c = 0, d = 1, e = 0, f = 0]) => [a, b, c, d, e, f],
  translate: ([x = 0, y = 0]) => [1, 0, 0, 1, x, y],
  scale: ([x = 1, y = x]) => [x, 0, 0, y, 0, 0],
  rotate: ([degrees = 0, cx = 0, cy = 0]) => rotation(degrees, cx, cy),
  skewX: ([degrees = 0]) => [1, 0, Math.tan(toRadians(degrees)), 1, 0, 0],
  skewY: ([degrees = 0]) => [1, Math.tan(toRadians(degrees)), 0, 1, 0, 0],
};

/** A `transform` attribute, composed left to right as the specification reads it. */
function parseTransform(value: string | undefined): Matrix {
  let m = IDENTITY;
  for (const { name, args } of scanFunctions(value ?? "")) {
    const numbers = args.split(/[\s,]+/).filter(Boolean).map(Number);
    m = multiply(m, TRANSFORMS[name]?.(numbers) ?? IDENTITY);
  }
  return m;
}

const num = (value: string | undefined, fallback = 0): number => {
  const parsed = parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** The paint a child inherits, after this element's own attributes. */
export function inheritPaint(parent: Paint, attrs: Attributes, unsupported: Set<string>): Paint {
  let fill = parent.fill;
  if (attrs.fill !== undefined) {
    const parsed = parseColour(attrs.fill);
    if (parsed === undefined) unsupported.add(`fill:${attrs.fill}`);
    // An unknown paint is drawn black: the shape is still there, and on a
    // one-colour printer black is the likeliest intent.
    fill = parsed === undefined ? [0, 0, 0] : parsed;
  }
  if (attrs.stroke !== undefined && attrs.stroke !== "none") unsupported.add("stroke");
  return {
    fill,
    fillOpacity: attrs["fill-opacity"] === undefined ? parent.fillOpacity : num(attrs["fill-opacity"], 1),
    opacity: parent.opacity * num(attrs.opacity, 1),
    rule: attrs["fill-rule"] === "evenodd" ? "evenodd" : attrs["fill-rule"] === "nonzero" ? "nonzero" : parent.rule,
    m: multiply(parent.m, parseTransform(attrs.transform)),
  };
}

/** A basic shape as path data, so one scan converter draws all of them. */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  if (rx <= 0 || ry <= 0) return "";
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

function rectPath(a: Attributes): string {
  const [x, y, w, h] = [num(a.x), num(a.y), num(a.width), num(a.height)];
  if (w <= 0 || h <= 0) return "";
  let rx = Math.min(num(a.rx, num(a.ry)), w / 2);
  let ry = Math.min(num(a.ry, num(a.rx)), h / 2);
  if (rx <= 0 || ry <= 0) [rx, ry] = [0, 0];
  if (rx === 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  return (
    `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}` +
    `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
    `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
  );
}

const SHAPES: Readonly<Record<string, (a: Attributes) => string>> = {
  path: (a) => a.d ?? "",
  rect: rectPath,
  circle: (a) => ellipsePath(num(a.cx), num(a.cy), num(a.r), num(a.r)),
  ellipse: (a) => ellipsePath(num(a.cx), num(a.cy), num(a.rx), num(a.ry)),
  polygon: (a) => (a.points ? `M${a.points}Z` : ""),
  polyline: (a) => (a.points ? `M${a.points}Z` : ""),
};

/** A drawable element as a shape, or null when it paints nothing. */
export function shapeOf(name: string, attrs: Attributes, paint: Paint): Shape | null {
  const toPath = SHAPES[name];
  if (toPath === undefined || paint.fill === null) return null;
  const polygons = pathToPolygons(toPath(attrs), paint.m);
  if (polygons.length === 0) return null;
  const alpha = Math.max(0, Math.min(1, paint.fillOpacity * paint.opacity)) * 255;
  return { polygons, rgba: [...paint.fill, alpha], rule: paint.rule };
}
