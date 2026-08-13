/**
 * `@12-apps/storage/react` — the browser half.
 *
 * One factory, {@link createWebStorage}. Everything else exported here is a part
 * of it that a host may legitimately want on its own: the hook for a bespoke
 * affordance, the re-encode for a form that shrinks a file before doing something
 * else with it, and the failure vocabulary for a host rendering its own messages.
 *
 * There is deliberately no export that uploads anywhere but this package's own
 * endpoint on the app's own origin.
 */

export {
  createWebStorage,
  type WebStorage,
  type WebStorageConfig,
} from './create-web-storage';

export { ImageField, type BoundImageFieldProps, type ImageFieldProps } from './image-field';

export {
  useUpload,
  type UploadOptions,
  type UploadState,
  type UseUploadConfig,
} from './use-upload';

export {
  CATALOG_IMAGE_PROFILE,
  optimizeImage,
  resetWebpSupportProbe,
  scaledSize,
  webpName,
  type ImageProfile,
} from './optimize-image';

export { rejectFileUpfront, transportFailure, uploadFailure } from './failures';
