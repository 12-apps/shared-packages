import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { StorageNotConfiguredError } from '../problems';
import type { StorageDriver } from '../server/driver';
import {
  assertRemoteUrlConfig,
  remoteObjectUrl,
  type RemoteObjectUrlConfig,
} from '../server/remote-url';

/**
 * `@12-apps/storage/s3` — objects in an S3-compatible bucket.
 *
 * Behind its own subpath with `@aws-sdk/client-s3` as an OPTIONAL peer, so a host
 * on local disk never resolves the SDK. `./server` deliberately does not
 * re-export this.
 *
 * ONE driver covers every S3-compatible vendor. AWS needs a `region`; DigitalOcean
 * Spaces, MinIO, R2 and the rest need an `endpoint`, plus `forcePathStyle` for the
 * ones that cannot do virtual-hosted addressing. A second vendor is therefore a
 * config entry and nothing else — no branch in the upload path, and no host code.
 *
 * Nothing here reads `process.env`. The credentials a deployment holds are the
 * deployment's business, and a package that read them would silently pick up
 * whatever happened to be exported in a test.
 */

export interface S3DriverConfig extends RemoteObjectUrlConfig {
  /** Explicit credentials. Omit to use the SDK's default chain (IAM role, …). */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /**
   * Canned ACL for stored objects. `public-read` by default, because an object is
   * loaded straight by an `<img>` with no bucket policy — and a private object
   * behind a public URL 403s for every visitor while the upload reports success.
   *
   * `undefined` for a bucket with `BucketOwnerEnforced`, which rejects ANY ACL
   * header; such a bucket needs a policy or a CDN in front of it instead.
   */
  acl?: 'private' | 'public-read' | undefined;
}

function buildClient(config: S3DriverConfig): S3Client {
  return new S3Client({
    ...(config.region ? { region: config.region } : {}),
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
    ...(config.credentials ? { credentials: config.credentials } : {}),
    // Do NOT compute an integrity checksum unless the operation requires one.
    // Since v3.729 the SDK adds a CRC32 by default; for a PRESIGNED PUT it is
    // computed over a body that is empty at signing time and then hoisted into the
    // URL, so a store that validates it rejects the upload for a digest mismatch
    // on bytes the signer never saw. This package never presigns, but the setting
    // is kept as a matter of record: it is the trap that made "the bytes go
    // through the server" the only shape here.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

/**
 * Objects in a bucket, written by the app server with credentials it already
 * holds. There is no method that hands a browser an address — see the root
 * entry for why that is the whole point.
 */
export function createS3Driver(config: S3DriverConfig): StorageDriver {
  // At construction, not at the first upload: an operator finds out from a boot
  // failure rather than from a store owner whose photo would not save.
  assertRemoteUrlConfig(config);
  const acl = 'acl' in config ? config.acl : 'public-read';
  let client: S3Client | undefined;
  // Built lazily and cached: endpoint resolution and the credential chain are not
  // free per call, and a host that only ever reads URLs never pays for either.
  const send = (command: PutObjectCommand | DeleteObjectCommand): Promise<unknown> => {
    client ??= buildClient(config);
    return client.send(command);
  };

  return {
    name: config.endpoint ? 's3-compatible' : 's3',
    put: async (key, bytes, contentType) => {
      if (!config.bucket) {
        throw new StorageNotConfiguredError('Storing an object needs a bucket.');
      }
      await send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          // A real request header, which the SDK signs. Passing `x-amz-acl` as a
          // presigned QUERY parameter is accepted and then silently ignored — the
          // object stores private behind a public URL.
          ...(acl ? { ACL: acl } : {}),
        }),
      );
    },
    // S3's DeleteObject is idempotent — removing a key that is not there answers
    // 204, not an error — which is exactly the contract the port advertises.
    delete: async (key) => {
      await send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
    publicUrl: (key) => remoteObjectUrl(config, key),
    // No `read`: the bytes are in the bucket, so the serve route redirects to
    // their public URL instead of streaming them through the app server.
  };
}
