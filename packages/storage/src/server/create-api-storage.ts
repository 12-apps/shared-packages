import { ACCEPTED_CONTENT_TYPES } from '../content-types';
import { DEFAULT_KEY_PREFIX } from '../keys';
import { megabytes } from '../limits';
import { defaultStorageMessages, type StorageMessages } from '../problems';
import { CATALOG_RENDITIONS, type RenditionSpec } from '../renditions';
import { imageSources, objectUrl, versionedObjectUrl, type ImageSources } from '../urls';
import { inlineImageSchema, type InlineImage } from '../wire';
import type { StorageDriver } from './driver';
import type { ImagePipeline } from './pipeline/port';
import {
  deleteIfOrphaned,
  deleteReplaced,
  discardMinted,
  objectKeysFor,
  type ReclaimDeps,
  type StorageLogger,
  type StorageReferenceProbe,
} from './reclaim';
import { storageRoutes, type StorageRoute } from './routes';
import { storeImage, storeInlineImage, type StoreImageDeps } from './store-image';

/**
 * `createApiStorage(config)` — the ONE thing a backend host mounts.
 *
 * Everything the upload system IS lives behind it: the endpoint, the streaming
 * cap, the magic-number check, the image pipeline, the key grammar, the rendition
 * set, the URL builder and the orphan reclaim. The host supplies config only —
 * where bytes live, who is calling, which of its tables can pin an object, and
 * the ceiling.
 *
 * ## Nothing here defaults to a value only one deployment can survive
 *
 * `driver`, `maxBytes`, `imagePipeline` and `unscopedKeys` are all REQUIRED, and
 * each for the same reason: the safe value is host-specific, so a default would
 * be a decision made by whoever typed the first host, silently inherited by
 * every one after it. A defaulted driver writes to a container's ephemeral disk
 * in production and reports success. A defaulted ceiling is whatever number this
 * file happens to carry. A defaulted pipeline decides whether crops exist at all.
 * A defaulted `unscopedKeys` decides whether one tenant's reclaim can reach
 * another tenant's bytes.
 */

export interface ApiStorageConfig {
  /** Where bytes live. See `./drivers/local-disk` and `@12-apps/storage/s3`. */
  driver: StorageDriver;
  /**
   * The upload ceiling, in bytes. There is exactly one number: pass the same
   * value to any tool schema advertising it, or better, read it back off
   * {@link ApiStorage.limits} so the two cannot drift.
   */
  maxBytes: number;
  /** How bytes are downscaled and cropped. `passthroughImagePipeline()` opts out. */
  imagePipeline: ImagePipeline;
  /**
   * Whether a key with NO scope segment may be touched by a scoped caller.
   *
   * `'accept'` for a host whose existing rows predate the scope segment — such a
   * key carries no tenant, so only `references` stands between one tenant and
   * another's objects, and a host choosing it is saying it has those probes.
   * `'reject'` for a fresh host: every key it will ever mint is scoped, so a key
   * without a scope can only be someone else's or nobody's.
   */
  unscopedKeys: 'accept' | 'reject';
  /**
   * The host tables that can still need an object after the row stopped pointing
   * at it. Empty means a replaced object is reclaimed immediately — correct only
   * if nothing in the host copies a key.
   */
  references?: readonly StorageReferenceProbe[];
  /** Where a best-effort reclaim's failures go. Default: no-op, and say so. */
  logger?: StorageLogger;
  /** The derived sizes to cut. Default {@link CATALOG_RENDITIONS}. */
  renditions?: readonly RenditionSpec[];
  /** Top-level key segment. Default `products`. */
  keyPrefix?: string;
  /** pt-BR refusal copy overrides. */
  messages?: Partial<StorageMessages>;
}

/** What the mount reports about itself — the anti-drift surface. */
export interface StorageLimits {
  maxBytes: number;
  /** Formatted for a message a store owner reads (`8 MB`). */
  maxBytesLabel: string;
  contentTypes: readonly string[];
  driver: string;
  pipeline: string;
  /** Whether this mount cuts crops at all — false on a passthrough pipeline. */
  cutsRenditions: boolean;
}

export interface ApiStorage {
  routes: readonly StorageRoute[];
  limits: StorageLimits;
  /** Store raw bytes (the browser's path, and any host write holding bytes). */
  storeImage(input: { bytes: Uint8Array; contentType: string; scope: string }): Promise<string>;
  /** Store base64 bytes carried inside a write body — an agent's only path. */
  storeInlineImage(image: InlineImage, scope: string): Promise<string>;
  /** Schemas built from THIS mount's ceiling, for a host's tool definitions. */
  schemas: { inlineImage: ReturnType<typeof inlineImageSchema> };
  /** Resolve a stored key for display, through the active driver. */
  urls: {
    objectUrl(key: string | null): string | null;
    imageSources(key: string | null): ImageSources | null;
    versionedObjectUrl(key: string | null, version: string | null): string | null;
  };
  /** Reclaiming bytes nothing points at any more. Never throws. */
  reclaim: {
    deleteIfOrphaned(scope: string, key: string | null | undefined): Promise<void>;
    deleteReplaced(
      scope: string,
      before: readonly (string | null | undefined)[],
      after: readonly (string | null | undefined)[],
    ): Promise<void>;
    discardMinted(scope: string, keys: readonly (string | null | undefined)[]): Promise<void>;
    /** Every object key a stored photo occupies — the key plus its crops. */
    objectKeysFor(key: string): string[];
  };
}

/**
 * A logger that drops everything, and the only default in this file.
 *
 * A reclaim's failures are the one thing here that must not be raised — the write
 * it followed already succeeded — so they can only be reported. A host that
 * passes nothing is choosing not to hear about a bucket that has started refusing
 * deletes; that is a legitimate choice for a test and a bad one in production,
 * and it is stated here rather than hidden behind a `console` call that a server
 * logger would not pick up anyway.
 */
const SILENT: StorageLogger = { error: () => undefined };

export function createApiStorage(config: ApiStorageConfig): ApiStorage {
  const specs = config.renditions ?? CATALOG_RENDITIONS;
  const keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const messages: StorageMessages = {
    ...defaultStorageMessages({ limit: megabytes(config.maxBytes) }),
    ...config.messages,
  };
  const writeDeps: StoreImageDeps = {
    driver: config.driver,
    pipeline: config.imagePipeline,
    messages,
    maxBytes: config.maxBytes,
    specs,
    keyPrefix,
  };
  const reclaimDeps: ReclaimDeps = {
    driver: config.driver,
    probes: config.references ?? [],
    logger: config.logger ?? SILENT,
    unscopedKeys: config.unscopedKeys,
    specs,
    keyPrefix,
  };
  const resolve = (key: string): string => config.driver.publicUrl(key);

  return {
    routes: storageRoutes(writeDeps),
    limits: {
      maxBytes: config.maxBytes,
      maxBytesLabel: megabytes(config.maxBytes),
      contentTypes: ACCEPTED_CONTENT_TYPES,
      driver: config.driver.name,
      pipeline: config.imagePipeline.name,
      cutsRenditions: config.imagePipeline.cutsRenditions,
    },
    storeImage: (input) => storeImage(writeDeps, input),
    storeInlineImage: (image, scope) => storeInlineImage(writeDeps, image, scope),
    schemas: { inlineImage: inlineImageSchema(config.maxBytes) },
    urls: {
      objectUrl: (key) => objectUrl(key, resolve),
      imageSources: (key) => imageSources(key, resolve, { specs, prefix: keyPrefix }),
      versionedObjectUrl: (key, version) => versionedObjectUrl(key, version, resolve),
    },
    reclaim: {
      deleteIfOrphaned: (scope, key) => deleteIfOrphaned(reclaimDeps, scope, key),
      deleteReplaced: (scope, before, after) =>
        deleteReplaced(reclaimDeps, scope, before, after),
      discardMinted: (scope, keys) => discardMinted(reclaimDeps, scope, keys),
      objectKeysFor: (key) => objectKeysFor(key, specs, keyPrefix),
    },
  };
}
