import type { RasterImage } from "../model";
import { MAX_RASTER_HEIGHT, MAX_RASTER_WIDTH } from "./budget";

/**
 * Colour to one bit: which dots of a picture a one-colour printer should burn.
 *
 * A thermal head has one ink and no half-tones. Every pixel of a picture ends
 * up either black or paper, so the only question is which — and the obvious
 * answer, "darker than 50 % grey", is the one that fails in practice. Brand
 * colours are mostly LIGHT: an orange such as `#ED7A1F` has a luma of 0.57, so
 * a 50 % threshold prints nothing for it. A logo in that colour comes out as
 * whatever dark details it has — two dots, where a mascot's pupil and mouth
 * were — and the shape itself is gone.
 *
 * ## The policy
 *
 * `toMonochrome` looks at the picture first (see {@link isFlatArtwork}):
 *
 * - **Flat artwork** — a logo, a mark, an icon: a few solid colours on a plain
 *   ground — is THRESHOLDED at {@link DEFAULT_THRESHOLD}, 0.75. Every colour
 *   darker than a light grey becomes solid black, every lighter one becomes
 *   paper. What an owner sees: an orange, red, blue or green logo prints as a
 *   crisp black silhouette with its white details knocked out; a pale tint
 *   (luma 0.75 or more — light yellow, pastel, light grey) disappears, and the
 *   preview is where they find out.
 * - **A photograph** — many colours, smooth gradients — is DITHERED (Atkinson
 *   by default): the tone becomes a density of dots, so a face stays a face
 *   rather than collapsing into blots. An orange area comes out as a fine
 *   pattern of about 40 % black, not solid black.
 *
 * A transparent pixel is paper: it is composited over white before anything
 * else, which is what the roll underneath it is.
 *
 * Both halves can be forced (`mode: "threshold"` or `"dither"`), and the
 * threshold moved, when a host knows better than the classifier.
 */

/** Pixels as a canvas `ImageData` holds them: RGBA, 4 bytes each, straight alpha. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export type DitherKernel = "atkinson" | "floyd-steinberg";

export interface MonochromeOptions {
  /** `auto` (default) thresholds flat artwork and dithers photographs. */
  mode?: "auto" | "threshold" | "dither";
  /** Luma (0-1) below which a pixel is ink, when thresholding. Default 0.75. */
  threshold?: number;
  /** Error-diffusion kernel, when dithering. Default `atkinson`. */
  kernel?: DitherKernel;
}

/** A printable raster, plus how it was made — worth saying next to a preview. */
export interface MonochromeImage extends RasterImage {
  method: "threshold" | DitherKernel;
}

/**
 * Anything with a luma under this prints black when artwork is thresholded.
 * High on purpose: see the policy above.
 */
export const DEFAULT_THRESHOLD = 0.75;

/**
 * Perceived lightness of an sRGB colour, 0 (black) to 1 (white).
 *
 * Rec. 601 luma on the gamma-encoded values — the weighting JPEG and most
 * image tools call "grey" — so a threshold here means what a person expects
 * from a greyscale preview.
 */
export function luma(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Each pixel's luma, composited over white paper. */
function lumaPlane(image: RgbaImage): Float32Array {
  const plane = new Float32Array(image.width * image.height);
  for (let i = 0; i < plane.length; i += 1) {
    const o = i * 4;
    const alpha = (image.data[o + 3] ?? 255) / 255;
    const y = luma(image.data[o] ?? 0, image.data[o + 1] ?? 0, image.data[o + 2] ?? 0);
    plane[i] = y * alpha + (1 - alpha);
  }
  return plane;
}

/** A pixel's colour at 4 bits a channel, over white, as one key. */
function colourKey(data: RgbaImage["data"], o: number): number {
  const alpha = (data[o + 3] ?? 255) / 255;
  const over = (c: number): number => Math.round(c * alpha + 255 * (1 - alpha)) >> 4;
  return (over(data[o] ?? 0) << 8) | (over(data[o + 1] ?? 0) << 4) | over(data[o + 2] ?? 0);
}

/**
 * Is this a few flat colours (a logo) rather than a photograph?
 *
 * Counted at 4 bits per channel, the 16 commonest colours cover nearly all of
 * a logo — its inks, its ground, and the anti-aliased edges between them are a
 * thin minority — while a photograph spreads over hundreds. 85 % coverage is
 * the line.
 */
export function isFlatArtwork(image: RgbaImage): boolean {
  const total = image.width * image.height;
  if (total === 0) return true;
  const counts = new Map<number, number>();
  for (let i = 0; i < total; i += 1) {
    const key = colourKey(image.data, i * 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, 16);
  return top.reduce((sum, n) => sum + n, 0) / total >= 0.85;
}

function emptyRaster(width: number, height: number): Uint8Array {
  return new Uint8Array(Math.ceil(width / 8) * height);
}

function setDot(data: Uint8Array, width: number, x: number, y: number): void {
  const index = y * Math.ceil(width / 8) + (x >> 3);
  data[index] = (data[index] ?? 0) | (0x80 >> (x & 7));
}

function threshold(plane: Float32Array, width: number, height: number, level: number): Uint8Array {
  const data = emptyRaster(width, height);
  plane.forEach((value, i) => {
    if (value < level) setDot(data, width, i % width, Math.floor(i / width));
  });
  return data;
}

/** [dx, dy, weight] — where a pixel's rounding error goes. */
const KERNELS: Readonly<Record<DitherKernel, readonly (readonly [number, number, number])[]>> = {
  // Atkinson spreads only 6/8 of the error, so highlights stay clean and
  // shadows stay open — kinder to a thermal head, which bleeds dots together.
  atkinson: [
    [1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8],
  ],
  "floyd-steinberg": [
    [1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16],
  ],
};

function spreadError(plane: Float32Array, width: number, height: number, at: number, error: number, kernel: DitherKernel): void {
  const x = at % width;
  const y = Math.floor(at / width);
  for (const [dx, dy, weight] of KERNELS[kernel]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= width || ny >= height) continue;
    const index = ny * width + nx;
    plane[index] = (plane[index] ?? 0) + error * weight;
  }
}

function dither(source: Float32Array, width: number, height: number, kernel: DitherKernel): Uint8Array {
  const plane = Float32Array.from(source);
  const data = emptyRaster(width, height);
  for (let i = 0; i < plane.length; i += 1) {
    const value = plane[i] ?? 1;
    const ink = value < 0.5;
    if (ink) setDot(data, width, i % width, Math.floor(i / width));
    spreadError(plane, width, height, i, value - (ink ? 0 : 1), kernel);
  }
  return data;
}

/**
 * Refuse, before allocating anything, an image that is malformed or bigger
 * than any receipt picture: its buffer must hold exactly `width × height × 4`
 * bytes, and it must fit `MAX_RASTER_WIDTH` × `MAX_RASTER_HEIGHT`.
 *
 * This THROWS (a `RangeError`) where `rasterizeSvg` returns a refusal, because
 * the two inputs differ: an SVG is a whole untrusted document, while these
 * dimensions are the host's own choice after decoding — a mismatch here is a
 * bug in the caller, not something an upload can reach.
 */
function assertPrintable({ width, height, data }: RgbaImage): void {
  const whole = Number.isInteger(width) && Number.isInteger(height) && width >= 0 && height >= 0;
  if (!whole || width > MAX_RASTER_WIDTH || height > MAX_RASTER_HEIGHT) {
    throw new RangeError(`image ${width}x${height} exceeds ${MAX_RASTER_WIDTH}x${MAX_RASTER_HEIGHT} dots`);
  }
  if (data.length !== width * height * 4) {
    throw new RangeError(`image data holds ${data.length} bytes, expected ${width * height * 4}`);
  }
}

/**
 * Convert RGBA pixels to a printable 1-bit raster, at the size they are.
 *
 * Supply the pixels at the printer's dot size — one pixel per dot, at most
 * `printableDotsFor(paperWidthMm)` wide. Scaling a thresholded bitmap after
 * the fact is how a logo gets jagged, so the size is decided before the bit.
 */
export function toMonochrome(image: RgbaImage, options: MonochromeOptions = {}): MonochromeImage {
  assertPrintable(image);
  const { width, height } = image;
  const plane = lumaPlane(image);
  const mode = options.mode ?? "auto";
  const useThreshold = mode === "threshold" || (mode === "auto" && isFlatArtwork(image));
  if (useThreshold) {
    const data = threshold(plane, width, height, options.threshold ?? DEFAULT_THRESHOLD);
    return { width, height, data, method: "threshold" };
  }
  const kernel = options.kernel ?? "atkinson";
  return { width, height, data: dither(plane, width, height, kernel), method: kernel };
}
