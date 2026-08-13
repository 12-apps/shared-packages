import { describe, expect, it } from 'vitest';

import { CATALOG_RENDITIONS } from '../../renditions';
import { passthroughImagePipeline } from '../pipeline/passthrough';
import { createSharpImagePipeline } from '../pipeline/sharp';
import type { ImagePipeline } from '../pipeline/port';
import { fakePipeline } from './fixtures';
import { sharpStub } from './sharp-stub';

/**
 * The ONE suite every {@link ImagePipeline} has to pass, whichever implementation
 * it is.
 *
 * It exists because of a question worth asking out loud: the shipped sharp adapter
 * is exercised against a STUB module (libvips cannot be loaded in this
 * environment), the endpoint and reclaim suites drive a test double, and the
 * consumer harness drives a third. Three implementations, and until this file
 * nothing asserted they answer the port the same way — so a double could satisfy
 * every caller while the real adapter broke an invariant those callers rely on,
 * and every suite would stay green.
 *
 * These are the invariants the port DOCUMENTS, and each one is load-bearing for a
 * caller:
 *
 *   - neither operation ever THROWS, because the caller is a write that must
 *     answer with a status rather than a stack trace;
 *   - `cut` returns an empty list or a COMPLETE set, never a partial one — a
 *     browser handed a key whose shape promises five objects draws the
 *     broken-image glyph for the ones that are missing;
 *   - a set comes back one-per-spec, in the order asked for, because the srcSet
 *     builder derives its width descriptors from that same list;
 *   - every rendition carries bytes;
 *   - `process` reports a PROBLEM rather than inventing an image.
 *
 * What this suite deliberately does NOT claim: that the pixels are right. No
 * implementation here decodes a real image (see the README's note on the injected
 * module), so "the crop is 320×240 of the product" is not asserted anywhere in this
 * repository. It is stated as a gap rather than implied by a green run.
 */

const GARBAGE = new TextEncoder().encode('<html>not an image at all</html>');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** Every implementation a caller in this repository can be handed. */
const IMPLEMENTATIONS: readonly { name: string; build: () => ImagePipeline }[] = [
  { name: 'passthrough (shipped)', build: () => passthroughImagePipeline() },
  {
    name: 'sharp (shipped, stub module)',
    build: () => createSharpImagePipeline({ sharp: sharpStub({ outputLength: 4 }).sharp }),
  },
  { name: 'fake (the suites double)', build: () => fakePipeline() },
];

describe.each(IMPLEMENTATIONS)('the ImagePipeline contract — $name', ({ build }) => {
  it('states whether it cuts renditions at all', () => {
    expect(typeof build().cutsRenditions).toBe('boolean');
    expect(typeof build().name).toBe('string');
  });

  it('never throws from process, whatever the bytes are', async () => {
    const pipeline = build();

    for (const bytes of [GARBAGE, PNG, new Uint8Array(0)]) {
      await expect(pipeline.process(bytes, 'image/png')).resolves.toBeDefined();
    }
  });

  it('never throws from cut, whatever the bytes are', async () => {
    const pipeline = build();

    for (const bytes of [GARBAGE, PNG, new Uint8Array(0)]) {
      await expect(pipeline.cut(bytes, CATALOG_RENDITIONS)).resolves.toBeInstanceOf(Array);
    }
  });

  it('answers process with an image or a PROBLEM, never with neither', async () => {
    const result = await build().process(PNG, 'image/png');

    if (result.ok) {
      expect(result.image.bytes.byteLength).toBeGreaterThan(0);
      expect(result.image.contentType).toMatch(/^image\//);
    } else {
      expect(typeof result.problem).toBe('string');
    }
  });

  it('cuts a COMPLETE set or none at all — never a partial one', async () => {
    const outputs = await build().cut(PNG, CATALOG_RENDITIONS);

    expect([0, CATALOG_RENDITIONS.length]).toContain(outputs.length);
  });

  it('returns a set one-per-spec, in the order it was asked for', async () => {
    const outputs = await build().cut(PNG, CATALOG_RENDITIONS);

    if (outputs.length > 0) {
      expect(outputs.map((output) => output.spec.name)).toEqual(
        CATALOG_RENDITIONS.map((spec) => spec.name),
      );
    }
  });

  it('gives every rendition bytes', async () => {
    for (const output of await build().cut(PNG, CATALOG_RENDITIONS)) {
      expect(output.bytes.byteLength, output.spec.name).toBeGreaterThan(0);
    }
  });

  it('honors a caller-supplied spec list rather than a list of its own', async () => {
    const specs = [{ name: 'only-one', width: 100, height: 100, family: 'card' as const }];

    const outputs = await build().cut(PNG, specs);

    expect([0, 1]).toContain(outputs.length);
    if (outputs.length > 0) expect(outputs[0]?.spec.name).toBe('only-one');
  });
});

describe('where the implementations legitimately DIFFER', () => {
  it('passthrough cuts nothing, and says so before it is called', async () => {
    // Not a degraded mode: it is the behaviour every catalog image had before crops
    // existed, and the flat key shape reports it truthfully.
    const pipeline = passthroughImagePipeline();

    expect(pipeline.cutsRenditions).toBe(false);
    expect(await pipeline.cut(PNG, CATALOG_RENDITIONS)).toEqual([]);
  });

  it('sharp cuts a set, and says so before it is called', async () => {
    const pipeline = createSharpImagePipeline({ sharp: sharpStub({ outputLength: 4 }).sharp });

    expect(pipeline.cutsRenditions).toBe(true);
    expect(await pipeline.cut(PNG, CATALOG_RENDITIONS)).toHaveLength(CATALOG_RENDITIONS.length);
  });

  it('only passthrough refuses a format mismatch in process — which is why the WRITER checks', async () => {
    // The asymmetry that produced an adversarial finding. Passthrough verifies as
    // part of doing nothing; sharp cannot, because "did it decode" and "is it the
    // declared format" are different questions and libvips answers plenty of formats
    // this allowlist excludes. Neither is wrong — it is why `storeImage` owns the
    // byte check rather than trusting whichever pipeline it was handed.
    expect(await passthroughImagePipeline().process(GARBAGE, 'image/png')).toMatchObject({
      ok: false,
      problem: 'content_mismatch',
    });

    const permissive = createSharpImagePipeline({
      sharp: sharpStub({ outputLength: 4 }).sharp,
    });
    expect((await permissive.process(GARBAGE, 'image/png')).ok).toBe(true);
  });
});
