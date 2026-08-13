import { EXTENSION_BY_CONTENT_TYPE } from '../../content-types';
import type { RenditionOutput, RenditionSpec } from '../../renditions';
import type { Rgba, SharpImage, SharpMetadata, SharpModule } from './sharp-module';

/**
 * Cutting the derived crops — the half of the sharp pipeline that decides what a
 * card actually looks like.
 *
 * ## Why the crop PADS instead of cutting
 *
 * `fit: 'cover'` is the obvious way to fill a 4:3 box and it is the wrong one. A
 * catalog shot is usually TALLER than 4:3 (bottles, cans, cups), so cover throws
 * away the top and bottom of the product — the exact pixels the photo is of.
 *
 * What was wasting the box was not the aspect ratio but the MARGIN: these are
 * product shots on a flat backdrop, and most of the frame is backdrop. So each
 * rendition is `trim`med to the product's own bounding box first, then
 * `contain`-fitted onto the exact canvas with that same backdrop colour behind
 * it. The product grows until it touches the edges of the box, nothing is cut
 * off, and the padding that remains is the colour the photo already had — so it
 * reads as the photo rather than as a letterbox. A cut-out PNG pads with
 * transparency for the same reason.
 *
 * Content is UPSCALED when the trimmed product is smaller than the canvas
 * (deliberately no `withoutEnlargement`). The alternative pads a 200px product
 * into a 1280px canvas, which the browser then scales DOWN to the card — drawing
 * the product at a quarter of the size it should be.
 *
 * ## Animated sources are not part of this
 *
 * sharp models an animation as a vertical filmstrip, so trimming and padding
 * would operate on the strip rather than on each frame. An animated source
 * therefore yields NO renditions, which is what routes it to the flat key shape
 * and keeps its frames.
 */

/** WebP quality for a rendition. */
const WEBP_QUALITY = 82;

/**
 * How far a pixel may differ from the corner colour and still count as backdrop.
 * sharp's default (10) is tuned for exactly this: it absorbs JPEG ringing and a
 * studio backdrop's gradient without eating a pale product.
 */
const TRIM_THRESHOLD = 10;

/**
 * Below this, a trim has eaten the picture rather than its margin — a photo that
 * is one flat colour, or one whose subject matches its backdrop closely enough
 * that nothing survives the threshold. The untrimmed image is used instead:
 * worse framing beats no product.
 */
const MIN_TRIMMED_EDGE = 16;

/** sharp's format name for a catalog MIME type (`jpg` is spelled `jpeg`). */
export function sharpFormatFor(contentType: string): string {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  return extension === 'jpg' ? 'jpeg' : (extension ?? 'webp');
}

/**
 * The animated read's header — one probe, reused for the two questions that have
 * to be answered before anything is decoded.
 *
 * The ANIMATED read specifically: `sharp(bytes)` without `{ animated: true }`
 * decodes frame one and hands back a perfectly good still, so a still read would
 * report `pages: 1` for a GIF that has twenty and an animation would silently
 * become five motionless WebPs.
 */
async function animatedMetadata(
  sharp: SharpModule,
  bytes: Uint8Array,
): Promise<SharpMetadata> {
  return sharp(bytes, { animated: true }).metadata();
}

/** Does the source carry more than one frame? */
export async function isAnimatedSource(
  sharp: SharpModule,
  bytes: Uint8Array,
): Promise<boolean> {
  return ((await animatedMetadata(sharp, bytes)).pages ?? 1) > 1;
}

/**
 * Would decoding this source cost more than `maxPixels`?
 *
 * The cut path needs its OWN answer to this, which is the whole point of the
 * function existing here. `process` enforces the ceiling and refuses a
 * decompression bomb — but the writer runs the two halves under one
 * `Promise.all`, so the refusal used to arrive AFTER this path had already read
 * the corner pixel, trimmed the full image and encoded five crops. An adversarial
 * probe on a 30000×30000 declared source reached `extract`, `trim` and five
 * `webp` encodes before the 413. The ceiling therefore bounded the status code
 * and not the memory, which is the one thing it exists to bound.
 *
 * Answered from the header alone, before a single pixel is allocated.
 */
function exceedsPixelBudget(metadata: SharpMetadata, maxPixels: number): boolean {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) return true;
  // `pages` multiplies the cost: a 1000×1000 GIF with 200 frames allocates as
  // much as a 200-megapixel still.
  return width * height * (metadata.pages ?? 1) > maxPixels;
}

/**
 * The photo's backdrop colour, read from its top-left pixel — the same pixel
 * sharp's `trim` measures against, so the padding put back is by construction
 * the colour that was taken away.
 *
 * Alpha is carried through: a PNG cut out on transparency trims to nothing and
 * must be padded with nothing, not with white.
 */
async function backdropColor(sharp: SharpModule, bytes: Uint8Array): Promise<Rgba> {
  const raw = await sharp(bytes)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return {
    r: raw[0] ?? 255,
    g: raw[1] ?? 255,
    b: raw[2] ?? 255,
    alpha: (raw[3] ?? 255) / 255,
  };
}

/**
 * The product's own bounding box, as PNG bytes — lossless on purpose, because
 * this buffer is re-encoded once per rendition and a lossy intermediate would
 * compound its artifacts five times over.
 *
 * Returns the input unchanged whenever trimming cannot be trusted: sharp raises
 * on an image it cannot trim at all, and a result that came back essentially
 * empty means the subject matched the backdrop rather than that there was none.
 */
async function trimToSubject(
  sharp: SharpModule,
  bytes: Uint8Array,
  backdrop: Rgba,
): Promise<Uint8Array> {
  try {
    const trimmed = await sharp(bytes)
      .trim({ background: backdrop, threshold: TRIM_THRESHOLD })
      .png()
      .toBuffer();
    const { width = 0, height = 0 } = await sharp(trimmed).metadata();
    if (width < MIN_TRIMMED_EDGE || height < MIN_TRIMMED_EDGE) return bytes;
    return trimmed;
  } catch {
    return bytes;
  }
}

/** Resize the trimmed subject onto one rendition's canvas, or `null` on failure. */
async function renderOne(
  sharp: SharpModule,
  source: Uint8Array,
  spec: RenditionSpec,
  backdrop: Rgba,
): Promise<Uint8Array | null> {
  try {
    return await (sharp(source) as SharpImage)
      .resize({
        width: spec.width,
        height: spec.height,
        // `contain`, so a tall bottle keeps its top and bottom; the canvas stays
        // exactly spec.width × spec.height, which is what lets the srcset width
        // descriptors be derived from the spec list alone.
        fit: 'contain',
        background: backdrop,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Cut every requested size from `bytes`.
 *
 * `bytes` is the ORIGINAL upload rather than the already-downscaled object: a
 * 1280px intermediate would be resampled a second time on the way to a 320px
 * card, and the source is decoded here regardless.
 *
 * Never throws. A source sharp cannot process yields an empty list and the
 * writer then stores the uncropped object alone.
 */
export async function cutRenditions(
  sharp: SharpModule,
  bytes: Uint8Array,
  specs: readonly RenditionSpec[],
  maxPixels: number,
): Promise<RenditionOutput[]> {
  let source: Uint8Array;
  let backdrop: Rgba;
  try {
    const metadata = await animatedMetadata(sharp, bytes);
    if ((metadata.pages ?? 1) > 1) return [];
    // Refused from the header, before `extract` or `trim` allocates anything. An
    // empty list is the documented answer for "this source yields no crops", and
    // `process` refuses the same source with the status the caller sees.
    if (exceedsPixelBudget(metadata, maxPixels)) return [];
    backdrop = await backdropColor(sharp, bytes);
    source = await trimToSubject(sharp, bytes, backdrop);
  } catch {
    return [];
  }

  const outputs: RenditionOutput[] = [];
  for (const spec of specs) {
    const cut = await renderOne(sharp, source, spec, backdrop);
    // One size failing is not a reason to keep the ones that worked: the srcset
    // builder reads the same spec list either way, so a browser would be handed
    // a key with no object behind it. A partial set is refused wholesale.
    if (!cut) return [];
    outputs.push({ spec, bytes: cut });
  }
  return outputs;
}
