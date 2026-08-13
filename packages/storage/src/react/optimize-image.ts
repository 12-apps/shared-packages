/**
 * Shrink a picked image BEFORE it is uploaded.
 *
 * A store owner picks the photo their phone or their supplier gave them, and that
 * is what used to reach the bucket byte for byte: catalog objects are routinely
 * 1–2 MB PNGs at 2000px, served whole into a card ~165px wide. The buyer
 * downloads a hundred times the pixels they can see, on a phone, on mobile data,
 * before the first price is legible — which is the entire "images take forever to
 * load" complaint.
 *
 * WHY IN THE BROWSER as well as on the server. Doing it here means the bytes never
 * travel at full size at all, so the upload itself gets faster and the size cap
 * stops rejecting photos that are perfectly usable once resized. It is the device
 * that picked the file doing work it can do for free. The server-side pipeline is
 * not a duplicate of this: it exists for callers that are not browsers.
 *
 * WHAT IT WILL NOT DO. Three deliberate pass-throughs, each returning the
 * ORIGINAL file untouched rather than a worse one:
 *
 *   - **GIFs.** A canvas holds one frame, so re-encoding would silently turn an
 *     animation into a still. Better large than broken.
 *   - **Anything the browser cannot decode or encode.** Engines without
 *     `createImageBitmap`, a corrupt file, a test environment with no canvas. The
 *     upload must keep working: optimization is an improvement, never a
 *     prerequisite — and never a new way for an upload to hang.
 *   - **A result that is not actually smaller.** An already-optimized 40 KB WebP
 *     can round-trip LARGER. The size comparison at the end is what makes this
 *     safe to run unconditionally.
 */

/** How an image is re-encoded. */
export interface ImageProfile {
  /**
   * Longest side, in pixels, of the uploaded image.
   *
   * Chosen against the largest box the photo is ever drawn into — a 4:3 hero on a
   * desktop viewport, with 2× headroom — NOT against the card. Storing only what
   * the card needs would make every zoom soft, and a zoom is exactly where
   * somebody looks closely.
   */
  maxEdge: number;
  /** WebP quality, 0–1. */
  quality: number;
}

export const CATALOG_IMAGE_PROFILE: ImageProfile = { maxEdge: 1280, quality: 0.82 };

/**
 * Types worth re-encoding. GIF is absent on purpose (see the header), and so is
 * anything outside the upload allowlist — an unrecognised type is the upload
 * layer's rejection to report, not ours to mangle first.
 */
const OPTIMIZABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Refuse to even DECODE beyond this. Decoding allocates width × height × 4 bytes
 * of bitmap, so a hostile or accidental 100 MB file is a tab crash rather than a
 * slow upload. Past this the file falls through untouched and the upload layer's
 * own cap rejects it with a message that names the size.
 */
const DECODE_CEILING_BYTES = 32 * 1024 * 1024;

/** Target box for `maxEdge`, preserving aspect ratio. Never enlarges. */
export function scaledSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  // At least 1px on the short side: a 4000×3 panorama would otherwise scale to a
  // zero-height canvas, and `drawImage` onto one throws.
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** `photo.png` → `photo.webp`; a name with no extension simply gains one. */
export function webpName(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.webp`;
}

/** Whether this browser's canvas can actually emit WebP. Probed once. */
let webpSupport: boolean | null = null;

function canEncodeWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    // `toDataURL` with an unsupported type does not throw — it silently answers a
    // PNG data URL. Reading the prefix back is the only honest probe, and it is
    // the same trap `toBlob` sets: it would hand back a PNG labelled WebP.
    webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/** Reset the cached probe. Tests only — a real browser's answer never changes. */
export function resetWebpSupportProbe(): void {
  webpSupport = null;
}

/**
 * Decode the file, or `null` if this environment cannot.
 *
 * `createImageBitmap` ONLY, deliberately. An `<img>` element whose `onload` and
 * `onerror` BOTH stay silent is a real state — and the one jsdom is permanently in
 * — which would leave this awaiting a promise that never settles, taking the
 * upload with it. Trading an unbounded hang for "no optimization on an old
 * browser" is not a close call. Decoding off the main thread is also the whole
 * point on the phone this runs on.
 */
async function decode(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(file);
  } catch {
    // A corrupt file, or a format this decoder will not take. Either way the
    // upload proceeds with exactly the bytes the owner picked.
    return null;
  }
}

/**
 * Draw `source` into a `target`-sized canvas and encode it.
 *
 * The canvas is left TRANSPARENT rather than filled: the bottle-on-white PNGs this
 * exists for carry an alpha channel, and WebP keeps it. That is also why the
 * non-WebP fallback re-encodes to the SOURCE type instead of to JPEG — a JPEG has
 * no alpha, so "optimizing" a cut-out product photo that way would hand the
 * storefront a black rectangle behind every bottle.
 */
async function encode(
  source: ImageBitmap,
  target: { width: number; height: number },
  profile: ImageProfile,
  sourceType: string,
): Promise<Blob | null> {
  // Probed BEFORE the drawing canvas exists: the probe allocates a canvas of its
  // own, and interleaving the two makes the order they are created in part of this
  // function's observable behaviour for no benefit.
  const type = canEncodeWebp() ? 'image/webp' : sourceType;

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, target.width, target.height);

  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), type, profile.quality);
  });
}

/**
 * Wrap an encoded blob as the file to upload, or `null` when it is not worth
 * swapping in.
 *
 * `>=` and not `>`: a tie is no reason to trade a known-good original for a
 * re-encode, and it keeps an already-optimal upload byte-identical. The rename is
 * not cosmetic either — the server stores the object under the type this file
 * declares.
 */
function asImprovedFile(blob: Blob | null, original: File): File | null {
  if (!blob || blob.size >= original.size) return null;
  const type = blob.type || original.type;
  const name = type === 'image/webp' ? webpName(original.name) : original.name;
  return new File([blob], name, { type, lastModified: original.lastModified });
}

/**
 * A smaller, web-ready version of `file` — or `file` itself when that is not
 * possible or not an improvement.
 *
 * Never throws and never rejects: every failure mode degrades to the original
 * file, so a caller can await it unconditionally.
 */
export async function optimizeImage(
  file: File,
  profile: ImageProfile = CATALOG_IMAGE_PROFILE,
): Promise<File> {
  if (!OPTIMIZABLE_TYPES.has(file.type) || file.size > DECODE_CEILING_BYTES) return file;

  const source = await decode(file);
  if (!source) return file;

  try {
    const { width, height } = source;
    if (width === 0 || height === 0) return file;
    const target = scaledSize(width, height, profile.maxEdge);
    const blob = await encode(source, target, profile, file.type);
    return asImprovedFile(blob, file) ?? file;
  } catch {
    // Any surprise from canvas/drawImage — a tainted source, an out-of-memory
    // allocation — leaves the upload with the file the owner actually picked.
    return file;
  } finally {
    // Frees the decoded bitmap immediately rather than at the next GC — on a phone
    // a 4000×3000 photo is 48 MB of it.
    source.close();
  }
}
