import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { logger } from '../../utils';

export async function uploadFileToS3 (bucketName: string, key: string, fileContent: string) {
  // Create S3 client
  const s3Client = new S3Client({});

  // Set upload parameters
  const params = {
    Body: fileContent,
    Bucket: bucketName,
    Key: key,
  };

  try {
    // Upload file to S3
    const command = new PutObjectCommand(params);
    const response = await s3Client.send(command);
    logger.info('File uploaded successfully', response);
  } catch (error) {
    logger.error('Error uploading file', error);
  }
};

/** Default presigned-URL lifetime (15 minutes). */
const DEFAULT_PRESIGN_EXPIRY_SECONDS = 900;

/** Parameters for {@link createPresignedUploadUrl}. */
export interface PresignUploadParams {
  /** Object key the client will PUT to (e.g. `products/<uuid>.png`). */
  key: string;
  /** MIME type the client will send; bound into the signature. */
  contentType: string;
  /** Bucket override; defaults to `S3_BUCKET`. */
  bucket?: string;
  /** Signature lifetime in seconds; defaults to 15 minutes. */
  expiresInSeconds?: number;
  /**
   * Canned ACL bound into the signature. Pass `"public-read"` so the stored
   * object is world-readable and can be loaded directly by `<img>` without a
   * bucket policy; omit for a private object. When set, the client's PUT must
   * send a matching `x-amz-acl` header.
   */
  acl?: "private" | "public-read";
}

/** Parameters for {@link putObjectToStorage}. */
export interface PutObjectParams {
  /** Object key to write (e.g. `products/<uuid>.png`). */
  key: string;
  /** The bytes to store. */
  body: Uint8Array;
  /** MIME type stored with the object, and served back on GET. */
  contentType: string;
  /** Bucket override; defaults to `S3_BUCKET`. */
  bucket?: string;
  /** Canned ACL; `"public-read"` so an `<img>` can load it without a policy. */
  acl?: "private" | "public-read";
}

/** Result of a presigned upload request. */
export interface PresignedUpload {
  /** Presigned PUT URL the browser uploads to directly. */
  url: string;
  /** The object key the file will live under once uploaded. */
  key: string;
  /**
   * The canned ACL bound into the signature, echoed back so the caller knows
   * to send a matching `x-amz-acl` header. Absent when no ACL was signed — the
   * client must then send NO ACL header (an unsigned/mismatched header 403s,
   * and `BucketOwnerEnforced` buckets reject any ACL header).
   */
  acl?: "private" | "public-read";
}

/** Module-level singleton so the SDK initialises once per process. */
let cachedS3Client: S3Client | undefined;

/** Drop the cached client so tests can exercise different `S3_*` env sets. */
export function resetS3ClientCache(): void {
  cachedS3Client = undefined;
}

/**
 * Return a shared `S3Client` built from the `S3_*` env vars, constructing it
 * lazily on first use and reusing it thereafter (a fresh client per call incurs
 * endpoint resolution + credential-chain lookup every time). Region/credentials
 * are only passed when present so the SDK default credential chain (IAM role,
 * profile, IMDS) still works in environments that don't set explicit keys.
 *
 * `S3_ENDPOINT` points the client at any S3-compatible store (DigitalOcean
 * Spaces: `https://<region>.digitaloceanspaces.com`); `S3_FORCE_PATH_STYLE=1`
 * opts into path-style addressing for stores that need it (e.g. MinIO).
 */
function getS3Client(): S3Client {
  if (cachedS3Client) {
    return cachedS3Client;
  }

  const region = process.env.S3_REGION;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  cachedS3Client = new S3Client({
    ...(region ? { region } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(process.env.S3_FORCE_PATH_STYLE === "1" ? { forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
    // Do NOT compute an integrity checksum unless the operation requires one.
    //
    // Since v3.729 the SDK adds a CRC32 by default, and for a PRESIGNED PUT it
    // computes that checksum over the command's body — which is empty at
    // signing time — then hoists it into the URL as
    // `x-amz-checksum-crc32=AAAAAA==` (the CRC32 of zero bytes). The browser
    // then PUTs the real file, and a store that validates the header rejects
    // the upload for a digest mismatch on bytes the signer never saw.
    // DigitalOcean Spaces happens to ignore the parameter, so the bug is
    // invisible on `spaces` and waits for whoever points `s3` at real AWS.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return cachedS3Client;
}

/**
 * Upload bytes to the bucket from the SERVER, returning once stored.
 *
 * The counterpart to {@link createPresignedUploadUrl}: same bucket, same canned
 * ACL, but the app process holds the credentials and the bytes, so the browser
 * never talks to object storage. That is what makes the upload immune to the
 * bucket's CORS configuration — see `app/api/uploads/object` in `apps/web`.
 *
 * `acl` is sent as a real request header here (the SDK signs it), which is the
 * only way the canned ACL actually applies: passing `x-amz-acl` as a presigned
 * QUERY parameter is accepted and then silently ignored, leaving a private
 * object behind a public URL.
 *
 * @throws if no bucket is configured (param or `S3_BUCKET`).
 */
export async function putObjectToStorage(params: PutObjectParams): Promise<void> {
  const bucket = params.bucket ?? process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3 bucket is not configured (set S3_BUCKET).');
  }

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ...(params.acl ? { ACL: params.acl } : {}),
    }),
  );
}

/**
 * Create a presigned PUT URL so the browser can upload a file straight to S3
 * without the bytes passing through the app server. The `contentType` is bound
 * into the signature, so the client must send a matching `Content-Type` header.
 *
 * @throws if no bucket is configured (param or `S3_BUCKET`).
 */
export async function createPresignedUploadUrl(
  params: PresignUploadParams,
): Promise<PresignedUpload> {
  const bucket = params.bucket ?? process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3 bucket is not configured (set S3_BUCKET).');
  }

  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ContentType: params.contentType,
    ...(params.acl ? { ACL: params.acl } : {}),
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: params.expiresInSeconds ?? DEFAULT_PRESIGN_EXPIRY_SECONDS,
  });

  return { url, key: params.key, ...(params.acl ? { acl: params.acl } : {}) };
}
