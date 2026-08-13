import type { StorageProblem } from '../../problems';
import type { ImagePipeline, ProcessResult } from './port';
import type { SharpMetadata, SharpModule } from './sharp-module';
import { cutRenditions, isAnimatedSource, sharpFormatFor } from './sharp-renditions';

/**
 * The real pipeline: downscale, re-encode, and cut the crops — with `sharp`
 * handed IN rather than imported (see `sharp-module.ts` for why).
 *
 * WHY THE SERVER RESIZES AT ALL, when a browser can do it for free. It can, and
 * a browser-side resize is still worth having — the bytes never travel at full
 * size. But it only covers callers that ARE browsers. An agent hands over
 * whatever bytes it was given, with no device and no canvas, and until something
 * resizes them a 2000px 1–2 MB PNG is served whole into a card ~165px wide. The
 * choice is a dependency or unbounded bytes in the bucket, and the dependency is
 * the host's to declare.
 *
 * WHAT IT WILL NOT DO, mirroring the browser profile's pass-throughs:
 *
 *   - **Enlarge.** A 300px photo is stored at 300px.
 *   - **Return something bigger.** An already-optimized WebP can round-trip
 *     larger; the size comparison keeps the original when it does.
 *   - **Flatten an animation.** Animated sources are resized WITH their frames
 *     and re-encoded in their own container rather than becoming a still WebP.
 *
 * It deliberately does NOT crop the uncropped object. Aspect ratio is preserved
 * on every path (`fit: 'inside'`), because that object is the one a ZOOM shows:
 * the whole photograph, margins and all. The crops are a separate set.
 */

export interface SharpPipelineConfig {
  /** The `sharp` module itself. */
  sharp: SharpModule;
  /** Longest edge, in pixels, of the stored uncropped object. Default 1280. */
  maxEdge?: number;
  /** WebP quality, 0–100. Default 82. */
  quality?: number;
  /**
   * Ceiling on the DECODED pixel count. A decode costs width × height × channels
   * bytes, so a "decompression bomb" — a small file declaring enormous dimensions
   * — is a way to exhaust the server's memory through an endpoint that otherwise
   * looks like an 8 MB upload. The honest bound is on pixels, since that is what
   * gets allocated. Default 50 megapixels.
   */
  maxPixels?: number;
}

/**
 * 1280 is measured against the largest box the object is ever drawn into — a 4:3
 * hero on a desktop viewport, with 2× headroom — not against the card, because a
 * lightbox is exactly where somebody looks closely.
 */
const DEFAULTS = { maxEdge: 1280, quality: 82, maxPixels: 50_000_000 } as const;

/** The refusals decided from the header alone. */
function rejectUnprocessable(
  metadata: SharpMetadata,
  maxPixels: number,
): StorageProblem | null {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) return 'image_unreadable';
  // `pages` multiplies the cost of an animation: a 1000×1000 GIF with 200 frames
  // allocates as much as a 200-megapixel still.
  if (width * height * (metadata.pages ?? 1) > maxPixels) {
    return 'image_dimensions_too_large';
  }
  return null;
}

export function createSharpImagePipeline(config: SharpPipelineConfig): ImagePipeline {
  const { sharp } = config;
  const maxEdge = config.maxEdge ?? DEFAULTS.maxEdge;
  const quality = config.quality ?? DEFAULTS.quality;
  const maxPixels = config.maxPixels ?? DEFAULTS.maxPixels;

  /** Probe the header, or `null` when the bytes are not a decodable image. */
  async function readMetadata(bytes: Uint8Array): Promise<SharpMetadata | null> {
    try {
      return await sharp(bytes).metadata();
    } catch {
      return null;
    }
  }

  /** Resize and re-encode, or `null` if the codec refused partway through. */
  async function encode(
    bytes: Uint8Array,
    animated: boolean,
    declaredContentType: string,
  ): Promise<Uint8Array | null> {
    try {
      const pipeline = sharp(bytes, animated ? { animated: true } : {}).resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      });
      return animated
        ? await pipeline.toFormat(sharpFormatFor(declaredContentType)).toBuffer()
        : await pipeline.webp({ quality }).toBuffer();
    } catch {
      return null;
    }
  }

  return {
    name: 'sharp',
    cutsRenditions: true,
    process: async (bytes, declaredContentType): Promise<ProcessResult> => {
      const metadata = await readMetadata(bytes);
      if (!metadata) return { ok: false, problem: 'image_unreadable' };
      const problem = rejectUnprocessable(metadata, maxPixels);
      if (problem) return { ok: false, problem };

      // Asked of the ANIMATED read: a still decode reports pages = 1 for a GIF
      // that has twenty, and flattening one is the failure this guards.
      const animated = await isAnimatedSource(sharp, bytes);
      const encoded = await encode(bytes, animated, declaredContentType);
      if (!encoded) return { ok: false, problem: 'image_unreadable' };

      // A re-encode that gained bytes is not an optimization. `>=` and not `>` so
      // a tie keeps the known-good original.
      if (encoded.byteLength >= bytes.byteLength) {
        return { ok: true, image: { bytes, contentType: declaredContentType } };
      }
      // An animation keeps its own container; everything else becomes WebP, which
      // is both the smallest of the accepted formats and what a browser-side
      // resize already produces, so the two uploaders converge.
      return {
        ok: true,
        image: {
          bytes: encoded,
          contentType: animated ? declaredContentType : 'image/webp',
        },
      };
    },
    cut: (bytes, specs) => cutRenditions(sharp, bytes, specs),
  };
}
