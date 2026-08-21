import { describe, expect, it } from 'vitest';
import { PT_BR_STORAGE_MESSAGES } from "../../pt-BR";
import type { StorageMessageContext, StorageMessages } from '../../problems';

import { DEFAULT_MAX_UPLOAD_BYTES } from '../../limits';
import { CATALOG_RENDITIONS } from '../../renditions';
import { createApiStorage, type ApiStorage } from '../create-api-storage';
import type { StorageRoute, StorageRouteResponse } from '../routes';
import {
  fakePipeline,
  memoryDriver,
  PNG_BYTES,
  uploadRequest,
  type MemoryDriver,
} from './fixtures';

/**
 * `POST <mount>/uploads/image` — the ONE entrance for a browser's bytes.
 *
 * The claims here are the reason the two-request presign contract was collapsed:
 * the key comes back already carrying its crops, and its SHAPE is decided from the
 * bytes rather than predicted before them. Everything else is a refusal, and each
 * one is a refusal a store owner can act on.
 */

const SCOPE = 'minha-loja';

interface Harness {
  api: ApiStorage;
  driver: MemoryDriver;
  post(request: Request, actor?: { scope: string; mayUpload: boolean } | null): Promise<StorageRouteResponse>;
}

function harness(pipelineCuts = true): Harness {
  // Named distinctly from what the cases destructure (`api`, `driver`, `route`): a
  // `const` holding a call result inside a module-level helper reads as shared state
  // to the flakiness gate, and every same-named local in a case then reads as a
  // mutation of it.
  const memory = memoryDriver();
  const mounted = createApiStorage({
    messages: PT_BR_STORAGE_MESSAGES,
    driver: memory,
    maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
    imagePipeline: fakePipeline({ cuts: pipelineCuts }),
    unscopedKeys: 'reject',
    references: [],
  });
  const entry = mounted.routes.find(
    (candidate: StorageRoute) => candidate.method === 'POST',
  ) as StorageRoute;
  return {
    api: mounted,
    driver: memory,
    post: (request, actor = { scope: SCOPE, mayUpload: true }) =>
      entry.handle({ actor, params: {}, request }),
  };
}

function bodyOf(response: StorageRouteResponse): Record<string, unknown> {
  return 'body' in response ? (response.body as Record<string, unknown>) : {};
}

function imageKeyOf(response: StorageRouteResponse): string {
  return (bodyOf(response).data as { imageKey: string }).imageKey;
}

describe('POST /uploads/image', () => {
  it('stores the photo AND its crops, and answers with the key to save', async () => {
    const { post, driver } = harness();

    const response = await post(uploadRequest(PNG_BYTES));

    expect(response.status).toBe(200);
    const key = imageKeyOf(response);
    // The SET shape: the caller gets back a key that already names a photo whose
    // crops exist — nothing was promised in advance.
    expect(key).toMatch(/^products\/minha-loja\/[0-9a-f-]{36}\/full\.webp$/);
    expect([...driver.objects.keys()].sort()).toEqual(
      [key, ...CATALOG_RENDITIONS.map((spec) => key.replace('full.webp', `${spec.name}.webp`))].sort(),
    );
  });

  it('scopes the key to the ACTOR, never to anything in the request', async () => {
    // The one thing a caller must not be able to choose: a key it picked could
    // address another tenant's object.
    const { post } = harness();

    const response = await post(uploadRequest(PNG_BYTES), { scope: 'outra-loja', mayUpload: true });

    expect(imageKeyOf(response)).toMatch(/^products\/outra-loja\//);
  });

  it('decides the key SHAPE from the result, not from the declared type', async () => {
    // A pipeline that cuts nothing — an animated source, or a host with no native
    // module — yields the flat key, which is what tells every later reader there
    // are no crops to ask for.
    const { post, driver } = harness(false);

    const response = await post(uploadRequest(PNG_BYTES));

    expect(imageKeyOf(response)).toMatch(/^products\/minha-loja\/[0-9a-f-]{36}\.webp$/);
    expect(driver.objects.size).toBe(1);
  });

  it('writes the uncropped object LAST, after every crop its key implies', async () => {
    // A request that dies partway then leaves objects nothing points at — which a
    // bucket forgets — rather than a row pointing at a photo whose card crop 404s.
    const recording = memoryDriver();
    const order: string[] = [];
    const inner = recording.put.bind(recording);
    recording.put = async (key, bytes, contentType) => {
      order.push(key);
      await inner(key, bytes, contentType);
    };
    const storage = createApiStorage({
    messages: PT_BR_STORAGE_MESSAGES,
      driver: recording,
      maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      imagePipeline: fakePipeline(),
      unscopedKeys: 'reject',
      references: [],
    });

    const key = await storage.storeImage({
      bytes: PNG_BYTES,
      contentType: 'image/png',
      scope: SCOPE,
    });

    expect(order.at(-1)).toBe(key);
    expect(order).toHaveLength(CATALOG_RENDITIONS.length + 1);
  });

  it('refuses an unauthenticated caller without storing anything', async () => {
    const { post, driver } = harness();

    const response = await post(uploadRequest(PNG_BYTES), null);

    expect(response.status).toBe(403);
    expect(driver.objects.size).toBe(0);
  });

  it("refuses a caller the host said may not upload", async () => {
    // "May this person upload" and "may this SESSION change anything" are both the
    // host's to answer; the package only narrows against the verdict.
    const { post, driver } = harness();

    const response = await post(uploadRequest(PNG_BYTES), { scope: SCOPE, mayUpload: false });

    expect(response.status).toBe(403);
    expect(driver.objects.size).toBe(0);
  });

  it('rejects a content type outside the allowlist', async () => {
    const { post } = harness();

    const response = await post(uploadRequest(PNG_BYTES, 'application/zip'));

    expect(response.status).toBe(400);
    // The configured SENTENCE, not the bare code — see "one number, stated once".
    expect(bodyOf(response).error).toBe(
      PT_BR_STORAGE_MESSAGES({ limit: '8 MB' }).unsupported_content_type,
    );
  });

  it('rejects bytes whose magic number contradicts the declared type', async () => {
    // Without this the endpoint is a way to park arbitrary content at a
    // world-readable URL on the store's own domain, served as whatever was claimed.
    const { post, driver } = harness();

    const response = await post(uploadRequest(new Uint8Array([0xff, 0xd8, 0xff]), 'image/png'));

    expect(response.status).toBe(400);
    expect(driver.objects.size).toBe(0);
  });

  it('rejects an empty body', async () => {
    const { post } = harness();

    expect((await post(uploadRequest(new Uint8Array(0)))).status).toBe(400);
  });

  it('rejects an oversize declared content-length without reading the body', async () => {
    const { post } = harness();
    const request = new Request('http://host.test/api/uploads/image', {
      method: 'POST',
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      headers: {
        'content-type': 'image/png',
        'content-length': String(DEFAULT_MAX_UPLOAD_BYTES + 1),
      },
    });

    const response = await post(request);

    expect(response.status).toBe(413);
    expect(bodyOf(response).error).toBe(
      PT_BR_STORAGE_MESSAGES({ limit: '8 MB' }).file_too_large,
    );
  });

  it('cancels a chunked oversize stream at the cap instead of buffering it all', async () => {
    const { post } = harness();
    const chunkBytes = 1024 * 1024;
    const stream = { enqueued: 0 };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (stream.enqueued >= 12 * chunkBytes) {
          controller.close();
          return;
        }
        stream.enqueued += chunkBytes;
        controller.enqueue(new Uint8Array(chunkBytes));
      },
    });
    // Chunked: no content-length, so only incremental reading can enforce the cap.
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body,
      duplex: 'half',
      headers: { 'content-type': 'image/png' },
    };

    const response = await post(new Request('http://host.test/api/uploads/image', init));

    expect(response.status).toBe(413);
    // The cap, the crossing chunk, and at most one prefetched chunk — never 12 MiB.
    expect(stream.enqueued).toBeLessThanOrEqual(DEFAULT_MAX_UPLOAD_BYTES + 2 * chunkBytes);
  });

  it('explains a corrupt image in the words a host write also uses', async () => {
    const { post } = harness();
    const refusing = createApiStorage({
    messages: PT_BR_STORAGE_MESSAGES,
      driver: memoryDriver(),
      maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      imagePipeline: fakePipeline({ process: () => ({ ok: false, problem: 'image_unreadable' }) }),
      unscopedKeys: 'reject',
      references: [],
    });
    const refusedRoute = refusing.routes[0] as StorageRoute;

    const response = await refusedRoute.handle({
      actor: { scope: SCOPE, mayUpload: true },
      params: {},
      request: uploadRequest(PNG_BYTES),
    });

    expect(response.status).toBe(400);
    expect(bodyOf(response).error).toContain('corrompido');
    // And the endpoint's own refusals are unchanged by that.
    expect((await post(uploadRequest(PNG_BYTES))).status).toBe(200);
  });

  it('reports unconfigured storage as 503, an operator problem', async () => {
    const { post, driver } = harness();
    const { StorageNotConfiguredError } = await import('../../problems');
    driver.failWith(new StorageNotConfiguredError('no bucket'));

    const response = await post(uploadRequest(PNG_BYTES));

    expect(response.status).toBe(503);
    expect(bodyOf(response).error).toContain('armazenamento');
  });

  it('reports any other driver failure as 502, not as a corrupt image', async () => {
    const { post, driver } = harness();
    driver.failWith(new Error('bucket timed out'));

    expect((await post(uploadRequest(PNG_BYTES))).status).toBe(502);
  });
});

describe('the mount reports its own limits', () => {
  it('echoes back the ceiling it enforces, so a tool schema cannot drift', () => {
    const { api } = harness();

    expect(api.limits).toMatchObject({
      maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      maxBytesLabel: '8 MB',
      driver: 'memory',
      pipeline: 'fake',
      cutsRenditions: true,
    });
    expect(api.limits.contentTypes).toContain('image/webp');
  });

  it('builds the inline-image schema from THAT ceiling', () => {
    const tight = createApiStorage({
    messages: PT_BR_STORAGE_MESSAGES,
      driver: memoryDriver(),
      maxBytes: 1024,
      imagePipeline: fakePipeline(),
      unscopedKeys: 'reject',
      references: [],
    });

    const parsed = tight.schemas.inlineImage.safeParse({
      contentType: 'image/png',
      contentBase64: 'A'.repeat(4096),
    });

    expect(parsed.success).toBe(false);
    expect(
      tight.schemas.inlineImage.safeParse({ contentType: 'image/png', contentBase64: 'AAAA' })
        .success,
    ).toBe(true);
  });

  it('states the configured limit in the refusal copy, not a hard-coded number', async () => {
    const smaller = createApiStorage({
    messages: PT_BR_STORAGE_MESSAGES,
      driver: memoryDriver(),
      maxBytes: 2 * 1024 * 1024,
      imagePipeline: fakePipeline(),
      unscopedKeys: 'reject',
      references: [],
    });

    await expect(
      smaller.storeInlineImage(
        { contentType: 'image/png', contentBase64: 'A'.repeat(4 * 1024 * 1024) },
        SCOPE,
      ),
    ).rejects.toThrow(/2 MB/);
  });
});

describe('one number, stated once — the ROUTE says it too', () => {
  /**
   * The regression for an adversarial finding, and the gap the case above could not
   * cover: it exercises `storeInlineImage`, so it cannot fail for the route.
   *
   * The endpoint used to answer the two refusals decided BEFORE the write path with
   * bare codes (`file_too_large`, `unsupported_content_type`) while every byte-level
   * refusal answered a finished sentence. The browser then mapped the code through
   * its OWN default ceiling, so a mount capped at 4 MB refusing a 6 MB file said
   * "o limite é 8 MB" — a number nothing applied, in the package whose headline
   * claim is that there is exactly ONE of them.
   */
  function mount(config: {
    maxBytes: number;
    messages?: (context: StorageMessageContext) => StorageMessages;
  }) {
    const api = createApiStorage({
      driver: memoryDriver(),
      maxBytes: config.maxBytes,
      imagePipeline: fakePipeline(),
      unscopedKeys: 'reject',
      references: [],
      messages: config.messages ?? PT_BR_STORAGE_MESSAGES,
    });
    const entry = api.routes.find(
      (candidate: StorageRoute) => candidate.method === 'POST',
    ) as StorageRoute;
    return (request: Request) =>
      entry.handle({ actor: { scope: SCOPE, mayUpload: true }, params: {}, request });
  }

  function oversize(maxBytes: number): Request {
    return new Request('http://host.test/api/uploads/image', {
      method: 'POST',
      body: PNG_BYTES,
      headers: { 'content-type': 'image/png', 'content-length': String(maxBytes + 1) },
    });
  }

  it("names THIS mount's ceiling in the 413, not the package default", async () => {
    const post = mount({ maxBytes: 4 * 1024 * 1024 });

    const response = await post(oversize(4 * 1024 * 1024));

    expect(response.status).toBe(413);
    expect(bodyOf(response).error).toContain('4 MB');
    // The exact wrong answer the finding described: the browser's own default.
    expect(bodyOf(response).error).not.toContain('8 MB');
  });

  it('carries the mount messages override into the 413', async () => {
    const post = mount({
      maxBytes: 1024,
      // A host's own factory: the pack, with one sentence rewritten.
      messages: (context) => ({
        ...PT_BR_STORAGE_MESSAGES(context),
        file_too_large: 'A foto passou do limite combinado com a loja.',
      }),
    });

    const response = await post(oversize(1024));

    expect(bodyOf(response).error).toBe('A foto passou do limite combinado com a loja.');
  });

  it('carries the override into the unsupported-type 400 as well', async () => {
    const post = mount({
      maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      messages: (context) => ({
        ...PT_BR_STORAGE_MESSAGES(context),
        unsupported_content_type: 'Só aceitamos PNG nesta loja.',
      }),
    });

    const response = await post(uploadRequest(PNG_BYTES, 'application/zip'));

    expect(response.status).toBe(400);
    expect(bodyOf(response).error).toBe('Só aceitamos PNG nesta loja.');
  });

  it('answers a SENTENCE rather than a code, which is what the browser relays', async () => {
    const post = mount({ maxBytes: 4 * 1024 * 1024 });

    // The browser's rule is "a stated value containing whitespace is a finished
    // sentence, relay it verbatim" — so this whitespace IS the contract between the
    // halves, not an incidental property of the copy.
    for (const request of [oversize(4 * 1024 * 1024), uploadRequest(PNG_BYTES, 'text/plain')]) {
      const error = bodyOf(await post(request)).error;
      expect(typeof error).toBe('string');
      expect(error as string).toMatch(/\s/);
    }
  });
});

describe('the byte check belongs to the WRITER, not to an entrance', () => {
  /**
   * The regression for an adversarial finding: the endpoint checked the bytes and
   * the base64 path got it from decoding, so the public `storeImage` — the one a
   * host calls when it already holds bytes — was the entrance that forgot. A probe
   * stored an HTML document under a `full.png` key, served as `image/png`.
   *
   * The stub pipeline here is exactly the shape the real one takes when a re-encode
   * comes out no smaller: it hands back the ORIGINAL bytes and the DECLARED type,
   * which is deliberate, and which is why `process` cannot be the thing that
   * notices.
   */
  const passthroughProcess = (bytes: Uint8Array, contentType: string) =>
    ({ ok: true, image: { bytes, contentType } }) as const;

  function permissive(): ApiStorage {
    return createApiStorage({
    messages: PT_BR_STORAGE_MESSAGES,
      driver: memoryDriver(),
      maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      imagePipeline: fakePipeline({ process: passthroughProcess }),
      unscopedKeys: 'reject',
      references: [],
    });
  }

  it('refuses arbitrary bytes through the public storeImage', async () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');

    await expect(
      permissive().storeImage({ bytes: html, contentType: 'image/png', scope: SCOPE }),
    ).rejects.toThrow(/não corresponde/);
  });

  it('stores NOTHING when it refuses', async () => {
    const driver = memoryDriver();
    const storage = createApiStorage({
    messages: PT_BR_STORAGE_MESSAGES,
      driver,
      maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      imagePipeline: fakePipeline({ process: passthroughProcess }),
      unscopedKeys: 'reject',
      references: [],
    });

    await expect(
      storage.storeImage({
        bytes: new TextEncoder().encode('<svg/>'),
        contentType: 'image/webp',
        scope: SCOPE,
      }),
    ).rejects.toThrow();
    expect(driver.objects.size).toBe(0);
  });

  it('refuses before the PIPELINE is reached at all', async () => {
    // Attacker bytes must not get as far as a decoder: the allowlist is upstream of
    // it, not a property of what the codec happens to accept.
    const seen: string[] = [];
    const storage = createApiStorage({
    messages: PT_BR_STORAGE_MESSAGES,
      driver: memoryDriver(),
      maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
      imagePipeline: {
        name: 'recording',
        cutsRenditions: true,
        process: async (bytes, contentType) => {
          seen.push('process');
          return passthroughProcess(bytes, contentType);
        },
        cut: async () => {
          seen.push('cut');
          return [];
        },
      },
      unscopedKeys: 'reject',
      references: [],
    });

    await expect(
      storage.storeImage({
        bytes: new TextEncoder().encode('not an image'),
        contentType: 'image/png',
        scope: SCOPE,
      }),
    ).rejects.toThrow();
    expect(seen).toEqual([]);
  });

  it('still refuses it through the inline (base64) path', async () => {
    const encoded = Buffer.from('<html></html>').toString('base64');

    await expect(
      permissive().storeInlineImage({ contentType: 'image/png', contentBase64: encoded }, SCOPE),
    ).rejects.toThrow();
  });

  it('and the endpoint answers the same refusal it always did', async () => {
    const { post } = harness();

    const response = await post(uploadRequest(new TextEncoder().encode('<html></html>')));

    expect(response.status).toBe(400);
    expect(bodyOf(response).error).toContain('não corresponde');
  });
});
