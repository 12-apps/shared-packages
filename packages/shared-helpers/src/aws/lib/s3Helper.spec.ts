import { afterEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock state so the (hoisted) vi.mock factories can reference it.
const { getSignedUrlMock, putCommandInputs, s3ClientConfigs } = vi.hoisted(() => ({
  getSignedUrlMock: vi.fn(),
  putCommandInputs: [] as Array<Record<string, unknown>>,
  s3ClientConfigs: [] as unknown[],
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
      s3ClientConfigs.push(config);
    }
  },
  PutObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
      putCommandInputs.push(input);
    }
  },
}));

import { createPresignedUploadUrl, resetS3ClientCache } from './s3Helper';

describe('createPresignedUploadUrl', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    putCommandInputs.length = 0;
    s3ClientConfigs.length = 0;
    resetS3ClientCache();
  });

  it('signs a PUT bound to the key + content type and returns the url', async () => {
    vi.stubEnv('S3_BUCKET', 'catalog-bucket');
    getSignedUrlMock.mockResolvedValue('https://signed.example/put');

    const result = await createPresignedUploadUrl({
      key: 'products/a.png',
      contentType: 'image/png',
    });

    expect(result).toEqual({ url: 'https://signed.example/put', key: 'products/a.png' });
    expect(putCommandInputs[0]).toMatchObject({
      Bucket: 'catalog-bucket',
      Key: 'products/a.png',
      ContentType: 'image/png',
    });
    // No ACL unless explicitly requested — the object stays private.
    expect(putCommandInputs[0]?.ACL).toBeUndefined();
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
  });

  it('binds a canned ACL into the signature when requested', async () => {
    vi.stubEnv('S3_BUCKET', 'catalog-bucket');
    getSignedUrlMock.mockResolvedValue('https://signed.example/put');

    const result = await createPresignedUploadUrl({
      key: 'products/a.png',
      contentType: 'image/png',
      acl: 'public-read',
    });

    expect(putCommandInputs[0]).toMatchObject({ ACL: 'public-read' });
    // The signed ACL is echoed back so the caller knows to send the header.
    expect(result).toEqual({
      url: 'https://signed.example/put',
      key: 'products/a.png',
      acl: 'public-read',
    });
  });

  it('honours an explicit bucket override', async () => {
    getSignedUrlMock.mockResolvedValue('https://signed.example/other');

    const result = await createPresignedUploadUrl({
      key: 'products/b.jpg',
      contentType: 'image/jpeg',
      bucket: 'override-bucket',
    });

    expect(result.key).toBe('products/b.jpg');
    expect(putCommandInputs[0]).toMatchObject({ Bucket: 'override-bucket' });
  });

  it('throws when no bucket is configured', async () => {
    vi.stubEnv('S3_BUCKET', '');

    await expect(
      createPresignedUploadUrl({ key: 'k', contentType: 'image/png' }),
    ).rejects.toThrow(/bucket/i);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('points the client at an S3-compatible endpoint (Spaces/MinIO) when configured', async () => {
    vi.stubEnv('S3_BUCKET', 'catalog-bucket');
    vi.stubEnv('S3_ENDPOINT', 'https://sfo3.digitaloceanspaces.com');
    vi.stubEnv('S3_FORCE_PATH_STYLE', '1');
    getSignedUrlMock.mockResolvedValue('https://signed.example/put');

    await createPresignedUploadUrl({ key: 'products/a.png', contentType: 'image/png' });

    expect(s3ClientConfigs.at(-1)).toMatchObject({
      endpoint: 'https://sfo3.digitaloceanspaces.com',
      forcePathStyle: true,
    });
  });
});
