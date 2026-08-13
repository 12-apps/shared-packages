import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageNotConfiguredError } from '../../problems';
import { createS3Driver } from '../index';

/**
 * The S3-compatible driver.
 *
 * `send` is intercepted on the SDK's own client rather than the module being
 * mocked: what is worth asserting is the command and the options that reach the
 * wire — the ACL as a real signed header, the bucket, the content type — and a
 * mocked module would let those drift while the suite stayed green.
 *
 * There is deliberately no test for a presigned URL, because there is no method
 * that produces one. See the root entry for the CORS failure that decides it.
 */

const KEY = 'products/minha-loja/3f2504e0-4f89-41d3-9a0c-0305e82c3301/full.webp';
const BYTES = new Uint8Array([1, 2, 3]);
const AWS = { bucket: 'catalog', region: 'us-east-1' } as const;

function captureSend(): { commands: unknown[] } {
  const commands: unknown[] = [];
  vi.spyOn(S3Client.prototype, 'send').mockImplementation((command: unknown) => {
    commands.push(command);
    return Promise.resolve({}) as never;
  });
  return { commands };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createS3Driver', () => {
  it('refuses at CONSTRUCTION when it could never build a display URL', () => {
    // An operator finds out from a boot failure rather than from a store owner whose
    // photo would not save.
    expect(() => createS3Driver({ bucket: '' })).toThrow(StorageNotConfiguredError);
    expect(() => createS3Driver({ bucket: 'catalog' })).toThrow(StorageNotConfiguredError);
  });

  it('names itself for the vendor shape it was configured with', () => {
    expect(createS3Driver(AWS).name).toBe('s3');
    expect(
      createS3Driver({ bucket: 'catalog', endpoint: 'https://sfo3.digitaloceanspaces.com' }).name,
    ).toBe('s3-compatible');
  });

  it('stores bytes world-readable, with the ACL as a real request field', () => {
    // Passing `x-amz-acl` as a presigned QUERY parameter is accepted and then
    // silently ignored — the object stores private behind a public URL and 403s for
    // every visitor while the upload reports success.
    const { commands } = captureSend();

    return createS3Driver(AWS)
      .put(KEY, BYTES, 'image/webp')
      .then(() => {
        expect(commands).toHaveLength(1);
        expect(commands[0]).toBeInstanceOf(PutObjectCommand);
        expect((commands[0] as PutObjectCommand).input).toMatchObject({
          Bucket: 'catalog',
          Key: KEY,
          Body: BYTES,
          ContentType: 'image/webp',
          ACL: 'public-read',
        });
      });
  });

  it('sends NO ACL when the host asked for none', async () => {
    // A `BucketOwnerEnforced` bucket rejects any ACL header at all.
    const { commands } = captureSend();

    await createS3Driver({ ...AWS, acl: undefined }).put(KEY, BYTES, 'image/webp');

    expect((commands[0] as PutObjectCommand).input.ACL).toBeUndefined();
  });

  it('deletes through the same bucket it wrote to', async () => {
    const { commands } = captureSend();

    await createS3Driver(AWS).delete(KEY);

    expect(commands[0]).toBeInstanceOf(DeleteObjectCommand);
    expect((commands[0] as DeleteObjectCommand).input).toMatchObject({
      Bucket: 'catalog',
      Key: KEY,
    });
  });

  it('builds the display URL from the same config, so writes and reads agree', () => {
    expect(createS3Driver(AWS).publicUrl(KEY)).toBe(
      `https://catalog.s3.us-east-1.amazonaws.com/${KEY}`,
    );
  });

  it('has NO read, which is what tells the serve route to redirect', () => {
    // The bytes are in the bucket; streaming them back through the app server would
    // pay for every byte twice.
    expect(createS3Driver(AWS).read).toBeUndefined();
  });

  it('builds no client until something is actually sent', () => {
    // Endpoint resolution and the credential chain are not free, and a host that
    // only ever resolves display URLs never pays for either.
    const send = vi.spyOn(S3Client.prototype, 'send');

    createS3Driver(AWS).publicUrl(KEY);

    expect(send).not.toHaveBeenCalled();
  });
});
