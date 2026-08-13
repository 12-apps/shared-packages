/**
 * `@12-apps/storage/server` — the backend half.
 *
 * One factory, {@link createApiStorage}, plus the ports it is configured with and
 * the implementations the package ships for them. Nothing here reads
 * `process.env`: every deployment-shaped decision is an argument, which is what
 * makes the same mount correct in a test, on a laptop and in production.
 *
 * The S3-compatible driver lives behind `@12-apps/storage/s3` instead of here, so
 * a host on local disk never resolves the AWS SDK — the same arrangement `hono`
 * has.
 */

export {
  createApiStorage,
  type ApiStorage,
  type ApiStorageConfig,
  type StorageLimits,
} from './create-api-storage';

export type { StorageDriver, StoredObject } from './driver';

export {
  createLocalDiskDriver,
  localObjectPath,
  type LocalDiskDriverConfig,
} from './drivers/local-disk';

export {
  assertRemoteUrlConfig,
  remoteObjectUrl,
  type RemoteObjectUrlConfig,
} from './remote-url';

export { passthroughImagePipeline } from './pipeline/passthrough';
export { createSharpImagePipeline, type SharpPipelineConfig } from './pipeline/sharp';
export type {
  ImagePipeline,
  ProcessResult,
  ProcessedImage,
} from './pipeline/port';
export type {
  Rgba,
  SharpImage,
  SharpMetadata,
  SharpModule,
  SharpResizeOptions,
} from './pipeline/sharp-module';

export { readBodyCapped } from './read-body';

export type { StorageLogger, StorageReferenceProbe } from './reclaim';

export { STORAGE_PATHS } from '../paths';

export {
  type StorageActor,
  type StorageRoute,
  type StorageRouteContext,
  type StorageRouteResponse,
} from './routes';
