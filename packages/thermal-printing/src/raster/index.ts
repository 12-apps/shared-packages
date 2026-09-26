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
import { paint } from "./fill";
import { DEFAULT_PAINT, inheritPaint, parseAttributes, shapeOf, type Attributes, type Paint, type Shape } from "./svg-doc";
import type { Matrix } from "./svg-path";
import type { RgbaImage } from "./monochrome";

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
  stack: Paint[];
  skipDepth: number;
  shapes: Shape[];
  unsupported: Set<string>;
}

const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

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
  const shape = shapeOf(name, attrs, own);
  if (shape !== null) walk.shapes.push(shape);
  if (!selfClosing) walk.stack.push(own);
}

function closeElement(walk: Walk): void {
  if (walk.skipDepth > 0) walk.skipDepth -= 1;
  else walk.stack.pop();
}

/** Every filled shape in document order, in device space. */
function collectShapes(body: string, root: Paint, unsupported: Set<string>): Shape[] {
  const walk: Walk = { stack: [root], skipDepth: 0, shapes: [], unsupported };
  for (const match of body.matchAll(TAG)) {
    const name = match[2];
    if (name === undefined) continue;
    if (match[1] === "/") closeElement(walk);
    else openElement(walk, name, parseAttributes(match[3] ?? ""), match[4] === "/");
  }
  return walk.shapes;
}

/**
 * Rasterise a flat-colour SVG to RGBA at the printer's dot size.
 *
 * `width` is in dots — `printableDotsFor(paperWidthMm)` for a full-width logo,
 * or less for a small mark (8 dots per millimetre: a 12 mm mark is 96 dots).
 * The result is ready for `toMonochrome`. An SVG with no usable size or no
 * root element comes back blank, with the reason in `unsupported`.
 */
export function rasterizeSvg(svg: string, options: SvgRasterOptions): SvgRaster {
  const unsupported = new Set<string>();
  const rootMatch = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(svg);
  const viewport = rootMatch ? viewportOf(parseAttributes(rootMatch[1] ?? "")) : null;
  const width = Math.max(0, Math.round(options.width));
  const aspect = viewport ? viewport.box[3] / viewport.box[2] : 1;
  const height = Math.max(0, Math.round(options.height ?? width * aspect));
  if (viewport === null || rootMatch === null) {
    unsupported.add(rootMatch === null ? "no <svg> root" : "no viewBox or size");
    return { width, height, data: new Uint8ClampedArray(width * height * 4), unsupported: [...unsupported] };
  }
  // The root's own attributes (a transform, a fill) apply to everything in it.
  const rootAttrs = parseAttributes(rootMatch[1] ?? "");
  const base = inheritPaint({ ...DEFAULT_PAINT, m: viewportMatrix(viewport, width, height) }, rootAttrs, unsupported);
  const body = svg.slice(rootMatch.index + rootMatch[0].length);
  const shapes = collectShapes(body, base, unsupported);
  return { width, height, data: paint(shapes, width, height), unsupported: [...unsupported] };
}
