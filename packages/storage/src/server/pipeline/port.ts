import type { RenditionOutput, RenditionSpec } from '../../renditions';
import type { StorageProblem } from '../../problems';

/**
 * The IMAGE PIPELINE port — how bytes are downscaled, re-encoded and cropped.
 *
 * It is a port rather than a dependency because image processing means a NATIVE
 * module, and a native module is build surface every consumer of this package
 * would pay for on every deploy whether or not it wants renditions. A host that
 * has `sharp` passes `createSharpImagePipeline({ sharp })` and gets the whole
 * behaviour; a host that does not passes {@link passthroughImagePipeline} and
 * gets uploads with no crops, which is exactly what every catalog image was
 * before crops existed. Neither choice is a default: `imagePipeline` is required
 * config, because "which one am I running?" is not a question a host should have
 * to discover from the shape of a key in production.
 *
 * The two operations are independent on purpose, and the writer runs them
 * together: cutting crops from the ORIGINAL bytes rather than from the
 * downscaled object avoids resampling a 1280px intermediate down to a 320px
 * card, and on a large photo the two are the whole cost of the request.
 */

/** What the pipeline decided the uncropped object should be. */
export interface ProcessedImage {
  bytes: Uint8Array;
  /** The type the object is STORED as — the extension is minted from it. */
  contentType: string;
}

export type ProcessResult =
  | { ok: true; image: ProcessedImage }
  | { ok: false; problem: StorageProblem };

export interface ImagePipeline {
  /** A name for the mount's own reporting. */
  readonly name: string;
  /**
   * Whether this pipeline cuts crops at all. Stated rather than inferred: a
   * consumer deciding what to draw needs to know before the first upload, and
   * "call it and see" is not an answer a host can put in a health check.
   */
  readonly cutsRenditions: boolean;
  /**
   * The uncropped object to store. NEVER throws: a decode failure is reported as
   * a problem, because the caller is a write that needs to answer with a status
   * rather than a stack trace.
   */
  process(bytes: Uint8Array, declaredContentType: string): Promise<ProcessResult>;
  /**
   * Cut every requested size, or return an EMPTY list.
   *
   * Empty is a first-class answer and the writer reads it as "this photo has no
   * crops", which is what routes it to the flat key shape. Never throws, and
   * never returns a PARTIAL set: a browser handed a key whose shape promises
   * five objects would draw the broken-image glyph for the ones that are missing,
   * so one size failing drops the four that worked.
   */
  cut(bytes: Uint8Array, specs: readonly RenditionSpec[]): Promise<RenditionOutput[]>;
}
