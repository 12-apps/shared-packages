import { mintObjectKey, mintObjectSetKey, renditionKey } from '../keys';
import { decodeImagePayload, verifyImageBytes } from '../payload';
import {
  StorageNotConfiguredError,
  StorageProblemError,
  type StorageMessages,
} from '../problems';
import { RENDITION_CONTENT_TYPE, type RenditionSpec } from '../renditions';
import type { InlineImage } from '../wire';
import type { StorageDriver } from './driver';
import type { ImagePipeline } from './pipeline/port';

/**
 * THE writer. Every stored photo is stored here, and nothing else decides what a
 * stored photo is made of.
 *
 * That single-owner rule is the point, and it was learned the hard way. An
 * earlier design had the answer in three places: the inline path minted a key
 * from what it had actually produced, the presign path GUESSED the same key's
 * shape from a content type and a config flag before a single byte existed, and
 * both then looped over the rendition list storing objects. Two of the three
 * could disagree — and did, structurally: a key minted on a guess promises crops
 * the bytes may turn out not to support, which is why that design needed a
 * `purpose` flag, an animation special case, a direct-upload special case, and a
 * 422 to break the promise afterwards. None of that is here. The key is minted
 * from FINISHED work, so it cannot promise anything that is not already stored.
 *
 * The two ways bytes arrive keep their own TRANSPORT and share this LOGIC:
 *
 *   - an AGENT sends them base64 inside the write that uses them, because a tool
 *     call is JSON and it cannot make an HTTP request of its own;
 *   - a BROWSER POSTs them to the upload endpoint and saves the key it gets back,
 *     which is what lets a draft reference a photo picked before the row exists.
 *
 * The order matters:
 *
 *   1. process the uncropped object — the whole picture, which is what a zoom
 *      shows;
 *   2. cut the crops from the ORIGINAL bytes, not from step 1's output;
 *   3. mint the key from the RESULT — the extension from the type the object was
 *      actually stored as, and the SHAPE from whether step 2 produced anything.
 */

export interface StoreImageDeps {
  driver: StorageDriver;
  pipeline: ImagePipeline;
  messages: StorageMessages;
  maxBytes: number;
  specs: readonly RenditionSpec[];
  keyPrefix: string;
}

interface StoreImageInput {
  bytes: Uint8Array;
  /** The type the caller declares. Corroborated against the bytes themselves. */
  contentType: string;
  /** The tenant the object belongs to — the key's scope segment. */
  scope: string;
}

function refuse(deps: StoreImageDeps, problem: keyof StorageMessages): never {
  throw new StorageProblemError(problem, deps.messages[problem]);
}

/**
 * Refuse bytes that are not really an image of `contentType`.
 *
 * Called on both entrances — the base64 decode does it as part of decoding, the
 * raw POST does it on the bytes it read — so neither can become a way to park
 * arbitrary content at a world-readable URL on the store's own domain.
 */
export function assertImageBytes(
  deps: StoreImageDeps,
  bytes: Uint8Array,
  contentType: string,
): void {
  const problem = verifyImageBytes(bytes, contentType);
  if (problem) refuse(deps, problem);
}

/** Write the crops first, then the object the row will name. */
async function writeSet(
  deps: StoreImageDeps,
  key: string,
  full: { bytes: Uint8Array; contentType: string },
  renditions: readonly { spec: RenditionSpec; bytes: Uint8Array }[],
): Promise<void> {
  try {
    // The uncropped object goes LAST, after every crop its key implies is already
    // in place. A request that dies partway then leaves objects nothing points at
    // — which a bucket forgets — rather than a row pointing at a photo whose card
    // crop 404s in every grid that draws it.
    await Promise.all(
      renditions.map((rendition) =>
        // Non-null: `renditions` is only non-empty for a set key.
        deps.driver.put(
          renditionKey(key, rendition.spec.name, deps.keyPrefix) as string,
          rendition.bytes,
          RENDITION_CONTENT_TYPE,
        ),
      ),
    );
    await deps.driver.put(key, full.bytes, full.contentType);
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) refuse(deps, 'storage_not_configured');
    refuse(deps, 'storage_unavailable');
  }
}

/**
 * Store `bytes` and return the key to save on the row.
 *
 * Throws {@link StorageProblemError} for anything the caller can fix, so a bad
 * image fails the whole write with a usable status instead of creating a row with
 * a silently missing photo.
 */
export async function storeImage(
  deps: StoreImageDeps,
  input: StoreImageInput,
): Promise<string> {
  const [processed, renditions] = await Promise.all([
    deps.pipeline.process(input.bytes, input.contentType),
    deps.pipeline.cut(input.bytes, deps.specs),
  ]);
  if (!processed.ok) refuse(deps, processed.problem);

  const { contentType } = processed.image;
  const mint = { scope: input.scope, contentType, prefix: deps.keyPrefix };
  // An empty rendition list is the animated case and the pipeline-declined case,
  // and both want the flat key: it is what tells every later reader that this
  // photo has no crops to ask for. Decided from the RESULT, never a prediction.
  const key = renditions.length > 0 ? mintObjectSetKey(mint) : mintObjectKey(mint);

  await writeSet(deps, key, processed.image, renditions);
  return key;
}

/**
 * {@link storeImage} for bytes that arrived base64-encoded inside a write body.
 *
 * The decode is the only thing this adds. Everything that happens to the bytes
 * afterwards is the same code a browser's upload runs, so a photo is the same set
 * of objects however it arrived.
 */
export async function storeInlineImage(
  deps: StoreImageDeps,
  image: InlineImage,
  scope: string,
): Promise<string> {
  const decoded = decodeImagePayload(image.contentBase64, image.contentType, deps.maxBytes);
  if (!decoded.ok) refuse(deps, decoded.problem);
  return storeImage(deps, { bytes: decoded.bytes, contentType: image.contentType, scope });
}
