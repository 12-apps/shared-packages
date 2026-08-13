import { StorageNotConfiguredError } from '../problems';

/**
 * The public URL of an object in an S3-compatible bucket.
 *
 * Pure, and in `./server` rather than in `./s3`, for two reasons: a host that
 * serves display URLs from a CDN needs the same builder without the SDK, and
 * every branch below is a real deployment that got this wrong once.
 */
export interface RemoteObjectUrlConfig {
  bucket: string;
  /** AWS region — the only thing needed for an AWS-hosted bucket. */
  region?: string;
  /** Endpoint of a non-AWS S3-compatible store (Spaces, MinIO, R2…). */
  endpoint?: string;
  /** Path-style addressing, for stores that cannot do virtual-hosted. */
  forcePathStyle?: boolean;
  /** A CDN in front of the bucket. Wins over everything else. */
  publicBaseUrl?: string;
}

/**
 * Config that cannot produce a URL at all.
 *
 * Raised at MOUNT time rather than at render time: a driver that returned the
 * bare key here would put a relative path in an `<img src>`, which resolves
 * against the app's own origin and 404s — a broken image with no error anywhere,
 * for every product in the catalog.
 */
export function assertRemoteUrlConfig(config: RemoteObjectUrlConfig): void {
  if (!config.bucket) {
    throw new StorageNotConfiguredError('An S3-compatible driver needs a bucket.');
  }
  if (!config.region && !config.endpoint && !config.publicBaseUrl) {
    throw new StorageNotConfiguredError(
      'An S3-compatible driver needs a region, an endpoint or a publicBaseUrl to build display URLs.',
    );
  }
}

export function remoteObjectUrl(config: RemoteObjectUrlConfig, key: string): string {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
  if (config.endpoint) {
    const base = config.endpoint.replace(/\/$/, '');
    if (config.forcePathStyle) {
      // Path-style, matching how such a store addresses objects. The endpoint's
      // own scheme is kept: a local http://localhost:9000 must not be rewritten
      // to https.
      return `${base}/${config.bucket}/${key}`;
    }
    // Virtual-hosted style on the S3-compatible endpoint (Spaces and friends).
    return `https://${config.bucket}.${base.replace(/^https?:\/\//i, '')}/${key}`;
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
}
