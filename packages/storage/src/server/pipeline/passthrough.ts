import { verifyImageBytes } from '../../payload';
import type { ImagePipeline, ProcessResult } from './port';

/**
 * Store the bytes as they arrived: no downscale, no re-encode, no crops.
 *
 * The pipeline for a host that will not take a native dependency. It is not a
 * degraded mode so much as the behaviour every catalog image had before crops
 * existed: one object, drawn `contain`, and a key whose shape says truthfully
 * that there are no crops to ask for.
 *
 * What it still does is verify: the magic-number check is what stops an upload
 * surface being a way to park arbitrary content at a world-readable URL on the
 * store's own domain, and that is not the resizer's job to provide.
 */
export function passthroughImagePipeline(): ImagePipeline {
  return {
    name: 'passthrough',
    cutsRenditions: false,
    process: async (bytes, declaredContentType): Promise<ProcessResult> => {
      const problem = verifyImageBytes(bytes, declaredContentType);
      return problem
        ? { ok: false, problem }
        : { ok: true, image: { bytes, contentType: declaredContentType } };
    },
    cut: async () => [],
  };
}
