/**
 * Pictures for a one-colour printer: SVG to pixels, and pixels to one bit.
 *
 * Two steps, both pure arithmetic with no canvas, no native module and no
 * WebAssembly, so they run the same in Node, in a browser and in a worker:
 *
 * 1. `rasterizeSvg(svg, { width })` — a flat-colour SVG (a logo, a mark) to
 *    RGBA at the printer's DOT size. Drawing the vector at the size it will
 *    print is what keeps a small mark legible; scaling a bitmap down after the
 *    fact blurs thin features into grey that a threshold then erases.
 * 2. `toMonochrome(rgba)` — RGBA to a `RasterImage`: flat artwork thresholded,
 *    photographs dithered. The policy, and what an owner sees, is documented in
 *    `./monochrome`.
 *
 * A bitmap logo (PNG, JPEG) skips step 1: decode it to RGBA at the dot width
 * with whatever the host already has — a canvas `getImageData` in a browser,
 * `sharp` or similar on a server — and hand the pixels to step 2. Decoding
 * compressed formats is deliberately not in this package: it is a codec per
 * format, and every host already carries one.
 *
 * ## Why a small SVG rasteriser rather than a full one
 *
 * The full-fidelity options each cost something this package does not pay
 * anywhere else: `resvg-js` and `sharp` are native modules (a prebuilt binary
 * per platform, and nothing in a browser), and the WebAssembly builds add a
 * couple of megabytes and an async initialisation to what is today a
 * dependency-free package. What a thermal printer can reproduce is one colour,
 * and a mark drawn for one plate is flat fills by construction — so the
 * rasteriser here draws exactly that: `path` (every command, arcs included),
 * `rect` (rounded too), `circle`, `ellipse`, `polygon`, `polyline`, nested `g`,
 * `transform`, `fill`, `fill-rule`, `fill-opacity`, `opacity`,
 * `viewBox` with `preserveAspectRatio` meet or none, anti-aliased.
 *
 * What it does NOT draw it NAMES in `unsupported` — strokes, gradients, text,
 * embedded images, `<use>`, clipping, masks, filters, CSS in `<style>` — rather
 * than guessing, so a host can refuse such a file, or rasterise it itself and
 * come in at step 2. A nested `<svg>` is drawn as a plain group (its own
 * viewport is ignored) and reported. An unsupported fill paint (a gradient) is drawn black, so
 * the silhouette survives.
 */
import { Budget, BudgetExceeded, MAX_RASTER_HEIGHT, MAX_RASTER_WIDTH } from "./budget";
import { paint } from "./fill";
import { DEFAULT_PAINT, inheritPaint, parseAttributes, shapeOf, type Attributes, type Paint, type Shape } from "./svg-doc";
import type { Matrix } from "./svg-path";
import { xmlTags, type XmlTag } from "./xml";
import type { RgbaImage } from "./monochrome";

export {
  MAX_FILL_WORK,
  MAX_PATH_POINTS,
  MAX_RASTER_HEIGHT,
  MAX_RASTER_WIDTH,
  MAX_SHAPES,
} from "./budget";
export {
  DEFAULT_THRESHOLD,
  isFlatArtwork,
  luma,
  toMonochrome,
  type DitherKernel,
  type MonochromeImage,
  type MonochromeOptions,
  type RgbaImage,
} from "./monochrome";

export interface SvgRasterOptions {
  /** Output width in printer dots. */
  width: number;
  /** Output height in dots. Default: the width times the viewBox's aspect ratio. */
  height?: number;
}

/** RGBA pixels, plus every SVG feature that was present and not drawn. */
export interface SvgRaster extends RgbaImage {
  data: Uint8ClampedArray;
  unsupported: string[];
}

/** Elements whose whole subtree paints nothing directly. */
const SKIPPED = new Set(["defs", "clipPath", "mask", "symbol", "pattern", "marker", "linearGradient", "radialGradient", "filter", "style", "title", "desc", "metadata"]);

/** Elements this rasteriser does not draw, reported by name when met. */
const REPORTED = new Set(["svg", "text", "image", "use", "foreignObject", "style", "clipPath", "mask", "filter", "pattern"]);

/** Attributes that change the picture and are not honoured. */
const REPORTED_ATTRIBUTES = ["clip-path", "mask", "filter"];

interface Viewport {
  box: readonly [number, number, number, number];
  aspect: string;
}

function viewBoxOf(value: string | undefined): Viewport["box"] | null {
  const parts = (value ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  const [x = 0, y = 0, w = 0, h = 0] = parts;
  return parts.length === 4 && parts.every(Number.isFinite) && w > 0 && h > 0 ? [x, y, w, h] : null;
}

function viewportOf(root: Attributes): Viewport | null {
  const aspect = root.preserveAspectRatio ?? "";
  const box = viewBoxOf(root.viewBox);
  if (box !== null) return { box, aspect };
  const [w, h] = [parseFloat(root.width ?? ""), parseFloat(root.height ?? "")];
  return w > 0 && h > 0 ? { box: [0, 0, w, h], aspect } : null;
}

/** viewBox to device: `meet` centred (the default), or `none` stretched. */
function viewportMatrix({ box, aspect }: Viewport, width: number, height: number): Matrix {
  const [x, y, w, h] = box;
  if (aspect.trim().startsWith("none")) return [width / w, 0, 0, height / h, -x * (width / w), -y * (height / h)];
  const s = Math.min(width / w, height / h);
  return [s, 0, 0, s, (width - w * s) / 2 - x * s, (height - h * s) / 2 - y * s];
}

interface Walk {
  budget: Budget;
  stack: Paint[];
  skipDepth: number;
  shapes: Shape[];
  unsupported: Set<string>;
}

function note(walk: Walk, name: string, attrs: Attributes): void {
  if (REPORTED.has(name)) walk.unsupported.add(name);
  for (const attribute of REPORTED_ATTRIBUTES) if (attrs[attribute] !== undefined) walk.unsupported.add(attribute);
}

function hidden(attrs: Attributes): boolean {
  return attrs.display === "none" || attrs.visibility === "hidden";
}

function openElement(walk: Walk, name: string, attrs: Attributes, selfClosing: boolean): void {
  if (walk.skipDepth > 0 || SKIPPED.has(name) || hidden(attrs)) {
    // Report the outermost skipped element; what is inside it never paints.
    if (walk.skipDepth === 0) note(walk, name, attrs);
    if (!selfClosing) walk.skipDepth += 1;
    return;
  }
  note(walk, name, attrs);
  const parent = walk.stack[walk.stack.length - 1] ?? DEFAULT_PAINT;
  const own = inheritPaint(parent, attrs, walk.unsupported);
  const shape = shapeOf(name, attrs, own, walk.budget);
  if (shape !== null) walk.shapes.push(shape);
  if (!selfClosing) walk.stack.push(own);
}

function closeElement(walk: Walk): void {
  if (walk.skipDepth > 0) walk.skipDepth -= 1;
  // A stray closing tag must not pop the root's paint: everything after it
  // would lose the viewport transform and draw at the wrong size.
  else if (walk.stack.length > 1) walk.stack.pop();
}

/** Every filled shape in document order, in device space. */
function collectShapes(body: string, root: Paint, unsupported: Set<string>, budget: Budget): Shape[] {
  const walk: Walk = { budget, stack: [root], skipDepth: 0, shapes: [], unsupported };
  for (const tag of xmlTags(body)) {
    if (tag.closing) closeElement(walk);
    else openElement(walk, tag.name, parseAttributes(tag.attrs), tag.selfClosing);
  }
  return walk.shapes;
}

/**
 * The largest document read, in characters. A one-plate mark is a few hundred
 * bytes and a detailed logo tens of kilobytes; past this the input is not
 * artwork. This bounds the PARSE; the output size and the fill work have
 * their own limits (`./budget`), because a short document can still declare a
 * huge canvas or stack thousands of full-canvas shapes.
 */
export const MAX_SVG_LENGTH = 256_000;

/** The root `<svg>` start tag, or null. */
function findRoot(svg: string): XmlTag | null {
  if (svg.length > MAX_SVG_LENGTH) return null;
  for (const tag of xmlTags(svg)) {
    if (!tag.closing && tag.name.toLowerCase() === "svg") return tag;
  }
  return null;
}

function rootProblem(svg: string, root: XmlTag | null): string {
  if (svg.length > MAX_SVG_LENGTH) return "too large";
  return root === null ? "no <svg> root" : "no viewBox or size";
}

/** An empty result carrying the reason the document was refused. */
function refused(reason: string, unsupported: Set<string>): SvgRaster {
  unsupported.add(reason);
  return { width: 0, height: 0, data: new Uint8ClampedArray(0), unsupported: [...unsupported] };
}

/** The output size, or the reason it is refused. Checked before anything is allocated. */
function outputSize(options: SvgRasterOptions, viewport: Viewport | null): { width: number; height: number } | string {
  const width = Math.round(options.width);
  const aspect = viewport ? viewport.box[3] / viewport.box[2] : 1;
  const height = Math.round(options.height ?? width * aspect);
  if (!(width > 0 && height > 0)) return "empty size";
  if (width > MAX_RASTER_WIDTH || height > MAX_RASTER_HEIGHT) return "output too large";
  return { width, height };
}

/**
 * Rasterise a flat-colour SVG to RGBA at the printer's dot size.
 *
 * `width` is in dots — `printableDotsFor(paperWidthMm)` for a full-width logo,
 * or less for a small mark (8 dots per millimetre: a 12 mm mark is 96 dots).
 * The result is ready for `toMonochrome`.
 *
 * A document that cannot be drawn is REFUSED, never thrown on: the result is
 * 0 × 0 and `unsupported` says why — `too large` (source over
 * `MAX_SVG_LENGTH`), `no <svg> root`, `no viewBox or size`, `empty size`,
 * `output too large` (over `MAX_RASTER_WIDTH` × `MAX_RASTER_HEIGHT`, checked
 * before allocating), `too many shapes`, `too many path points`, or `too
 * complex to fill`.
 */
export function rasterizeSvg(svg: string, options: SvgRasterOptions): SvgRaster {
  const unsupported = new Set<string>();
  const root = findRoot(svg);
  const rootAttrs = root === null ? {} : parseAttributes(root.attrs);
  const viewport = root === null ? null : viewportOf(rootAttrs);
  if (viewport === null || root === null) return refused(rootProblem(svg, root), unsupported);
  const size = outputSize(options, viewport);
  if (typeof size === "string") return refused(size, unsupported);
  const { width, height } = size;
  const budget = new Budget();
  try {
    // The root's own attributes (a transform, a fill) apply to everything in it.
    const base = inheritPaint({ ...DEFAULT_PAINT, m: viewportMatrix(viewport, width, height) }, rootAttrs, unsupported);
    const shapes = collectShapes(svg.slice(root.end), base, unsupported, budget);
    return { width, height, data: paint(shapes, width, height, budget), unsupported: [...unsupported] };
  } catch (error) {
    if (error instanceof BudgetExceeded) return refused(error.reason, unsupported);
    throw error;
  }
}
