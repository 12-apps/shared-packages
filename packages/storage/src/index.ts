/**
 * `@12-apps/storage` — uploads that land at YOUR OWN ORIGIN.
 *
 * The root entry is the isomorphic half: the format allowlist, the upload
 * ceiling, the object-key grammar, the rendition list, the refusal taxonomy and
 * the wire schemas. Both other halves are built on it, which is what keeps the
 * browser and the server agreeing about what an upload is.
 *
 * The design decision this package exists to preserve: **the browser PUTs at our
 * own origin, never at the bucket.** A presigned URL makes a working upload
 * depend on the bucket's CORS rules — configuration that lives in neither the
 * host repository nor any deploy it runs. When it is missing, the preflight is
 * refused, THE SERVER SEES NOTHING (no request arrives, no log line, no error
 * rate), the browser cannot say why (a blocked cross-origin fetch is
 * deliberately indistinguishable from an offline network), and the message
 * reaches a store owner about a bucket only an operator can configure. There is
 * therefore no "just presign it" mode here, and adding one would reintroduce all
 * three symptoms at once.
 *
 * A second reason it cannot come back: a stored photo is a SET of objects the
 * server derives from the bytes, so an upload the server never sees cannot
 * produce one.
 */

export {
  ACCEPTED_CONTENT_TYPES,
  CONTENT_TYPE_BY_EXTENSION,
  EXTENSION_BY_CONTENT_TYPE,
  acceptedContentTypeOf,
  isAcceptedContentType,
} from './content-types';

export { DEFAULT_MAX_UPLOAD_BYTES, maxBase64Length, megabytes } from './limits';

export { STORAGE_PATHS } from './paths';

export {
  DEFAULT_KEY_PREFIX,
  hasRenditions,
  isLegalScope,
  isObjectKey,
  keyInScope,
  mintObjectKey,
  mintObjectSetKey,
  parseObjectKey,
  parseObjectMemberKey,
  renditionKey,
  type MintKeyInput,
  type ObjectKey,
  type ObjectMemberKey,
} from './keys';

export {
  CATALOG_RENDITIONS,
  RENDITION_CONTENT_TYPE,
  renditionFamilies,
  type RenditionFamily,
  type RenditionOutput,
  type RenditionSpec,
} from './renditions';

export {
  decodeImagePayload,
  sniffImageContentType,
  verifyImageBytes,
  type DecodedPayload,
} from './payload';

export {
  STORAGE_PROBLEM_STATUS,
  StorageNotConfiguredError,
  StorageProblemError,
  defaultStorageMessages,
  isStorageProblem,
  type StorageMessageContext,
  type StorageMessages,
  type StorageProblem,
} from './problems';

export {
  imageSources,
  objectUrl,
  versionedObjectUrl,
  type ImageRenditionSet,
  type ImageSources,
  type ImageSourcesOptions,
  type PublicUrlResolver,
} from './urls';

export {
  inlineImageSchema,
  objectKeySchema,
  refineImageInput,
  uploadAcceptedSchema,
  type ImageFields,
  type InlineImage,
  type UploadAccepted,
} from './wire';
