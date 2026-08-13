import type { RenditionOutput, RenditionSpec } from '../../renditions';
import type { StorageDriver, StoredObject } from '../driver';
import type { ImagePipeline, ProcessResult } from '../pipeline/port';

/**
 * The doubles these suites drive.
 *
 * The DRIVER is in memory rather than mocked: what every claim here is about is
 * which objects exist afterwards, and a Map answers that question directly. The
 * PIPELINE is a double because the real one is `sharp`, and a package that made a
 * native module a test dependency would be exactly the coupling `imagePipeline`
 * exists to avoid — its own behaviour is covered against a stub module in
 * `pipeline/__tests__/sharp.test.ts`.
 */

export interface MemoryDriver extends StorageDriver {
  objects: Map<string, StoredObject>;
  /** Every key ever asked for, in order — including ones that were absent. */
  deleted: string[];
  /** Make the next write or delete fail with `error`. */
  failWith(error: Error | null): void;
}

export function memoryDriver(options: { readable?: boolean } = {}): MemoryDriver {
  const objects = new Map<string, StoredObject>();
  const deleted: string[] = [];
  // A container's property rather than a closed-over `let`: a stub that reassigns
  // its own binding is the shape the flakiness gate rejects, and rightly — it is
  // indistinguishable from state leaking between cases.
  const state: { failure: Error | null } = { failure: null };
  const driver: MemoryDriver = {
    name: 'memory',
    objects,
    deleted,
    failWith: (error) => {
      state.failure = error;
    },
    put: async (key, bytes, contentType) => {
      if (state.failure) throw state.failure;
      objects.set(key, { bytes, contentType });
    },
    delete: async (key) => {
      if (state.failure) throw state.failure;
      deleted.push(key);
      objects.delete(key);
    },
    publicUrl: (key) => `https://memory.test/${key}`,
  };
  if (options.readable !== false) {
    driver.read = async (key) => objects.get(key) ?? null;
  }
  return driver;
}

/** A driver with no `read` — a bucket, as far as the serve route is concerned. */
export function bucketDriver(publicUrl?: (key: string) => string): StorageDriver {
  const memory = memoryDriver({ readable: false });
  return publicUrl ? { ...memory, publicUrl } : memory;
}

interface FakePipelineOptions {
  /** What `process` answers. Default: the bytes unchanged, as WebP. */
  process?: (bytes: Uint8Array, contentType: string) => ProcessResult;
  /** Whether crops are produced. Default: one byte per spec. */
  cuts?: boolean;
}

/**
 * A deterministic pipeline. The bytes it emits are the spec's name, so a test can
 * assert WHICH rendition landed at which key without decoding anything.
 */
export function fakePipeline(options: FakePipelineOptions = {}): ImagePipeline {
  const cuts = options.cuts !== false;
  return {
    name: 'fake',
    cutsRenditions: cuts,
    process: async (bytes, contentType) =>
      options.process?.(bytes, contentType) ?? {
        ok: true,
        image: { bytes, contentType: 'image/webp' },
      },
    cut: async (_bytes, specs: readonly RenditionSpec[]): Promise<RenditionOutput[]> =>
      cuts ? specs.map((spec) => ({ spec, bytes: new TextEncoder().encode(spec.name) })) : [],
  };
}

/** Real PNG magic, so the byte check passes without a real image. */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03,
]);

/** A `Request` carrying `bytes` as the raw body. */
export function uploadRequest(bytes: Uint8Array, contentType = 'image/png'): Request {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Request('http://host.test/api/uploads/image', {
    method: 'POST',
    body: copy.buffer as ArrayBuffer,
    headers: { 'content-type': contentType },
  });
}

/** Collects the lines a reclaim logged, so a refusal is assertable. */
export function recordingLogger(): { lines: string[]; error(message: string): void } {
  const lines: string[] = [];
  return { lines, error: (message) => lines.push(message) };
}
