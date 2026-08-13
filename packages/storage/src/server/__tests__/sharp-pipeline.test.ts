import { describe, expect, it } from 'vitest';

import { CATALOG_RENDITIONS } from '../../renditions';
import { createSharpImagePipeline } from '../pipeline/sharp';
import { passthroughImagePipeline } from '../pipeline/passthrough';
import { argOf, argsOf, sharpStub, trimBackground } from './sharp-stub';

/**
 * The sharp pipeline's DECISIONS, driven through an injected module.
 *
 * Every claim here is a decision the port makes rather than a pixel libvips
 * produces: whether it enlarges, whether it flattens an animation, which colour the
 * padding is, and what happens when one size out of five fails.
 */

const SOURCE = new Uint8Array(4096);

describe('process', () => {
  it('downscales to the profile bound, as WebP, without enlarging', async () => {
    const stub = sharpStub({ outputLength: 512 });
    const pipeline = createSharpImagePipeline({ sharp: stub.sharp });

    const result = await pipeline.process(SOURCE, 'image/png');

    expect(result).toMatchObject({ ok: true, image: { contentType: 'image/webp' } });
    expect(argOf(stub.calls, 'resize')).toEqual({
      width: 1280,
      height: 1280,
      // `inside`, so the uncropped object keeps its aspect ratio — it is the one a
      // ZOOM shows, margins and all. Cropping happens in the rendition set.
      fit: 'inside',
      withoutEnlargement: true,
    });
    expect(argOf(stub.calls, 'webp')).toEqual({ quality: 82 });
  });

  it('honors a host that configured a different bound and quality', async () => {
    const stub = sharpStub({ outputLength: 512 });
    const pipeline = createSharpImagePipeline({ sharp: stub.sharp, maxEdge: 640, quality: 60 });

    await pipeline.process(SOURCE, 'image/png');

    expect(argOf(stub.calls, 'resize')).toMatchObject({ width: 640, height: 640 });
    expect(argOf(stub.calls, 'webp')).toEqual({ quality: 60 });
  });

  it('keeps the ORIGINAL bytes when re-encoding would not make them smaller', async () => {
    // An already-optimized WebP can round-trip larger. `>=`, so a tie keeps the
    // known-good original — and with it the original content type.
    const stub = sharpStub({ outputLength: SOURCE.byteLength });
    const pipeline = createSharpImagePipeline({ sharp: stub.sharp });

    const result = await pipeline.process(SOURCE, 'image/png');

    expect(result).toEqual({ ok: true, image: { bytes: SOURCE, contentType: 'image/png' } });
  });

  it('keeps an animation in its own container rather than flattening it', async () => {
    // A still decode reports pages = 1 for a GIF that has twenty, so the animated
    // read is asked explicitly — otherwise an animation becomes a motionless WebP.
    const stub = sharpStub({ metadata: { width: 400, height: 400, pages: 20 }, outputLength: 8 });
    const pipeline = createSharpImagePipeline({ sharp: stub.sharp });

    const result = await pipeline.process(SOURCE, 'image/gif');

    expect(result).toMatchObject({ ok: true, image: { contentType: 'image/gif' } });
    expect(argsOf(stub.calls, 'toFormat')).toEqual(['gif']);
    expect(stub.constructions).toContain(true);
  });

  it('spells jpg as sharp does', async () => {
    const stub = sharpStub({ metadata: { width: 400, height: 400, pages: 3 }, outputLength: 8 });

    await createSharpImagePipeline({ sharp: stub.sharp }).process(SOURCE, 'image/jpeg');

    expect(argsOf(stub.calls, 'toFormat')).toEqual(['jpeg']);
  });

  it('refuses bytes it cannot decode rather than storing them', async () => {
    const stub = sharpStub({ failOn: ['metadata'] });

    expect(await createSharpImagePipeline({ sharp: stub.sharp }).process(SOURCE, 'image/png')).toEqual(
      { ok: false, problem: 'image_unreadable' },
    );
  });

  it('refuses an image with no dimensions', async () => {
    const stub = sharpStub({ metadata: { width: 0, height: 0 } });

    expect(await createSharpImagePipeline({ sharp: stub.sharp }).process(SOURCE, 'image/png')).toEqual(
      { ok: false, problem: 'image_unreadable' },
    );
  });

  it('refuses a decompression bomb on its PIXEL count, not its file size', async () => {
    // A small file declaring enormous dimensions is a way to exhaust the server's
    // memory through an endpoint that otherwise looks like an 8 MB upload.
    const stub = sharpStub({ metadata: { width: 30_000, height: 30_000, pages: 1 } });

    expect(await createSharpImagePipeline({ sharp: stub.sharp }).process(SOURCE, 'image/png')).toEqual(
      { ok: false, problem: 'image_dimensions_too_large' },
    );
  });

  it('counts an animation FRAME BY FRAME against that ceiling', async () => {
    // A 1000×1000 GIF with 200 frames allocates as much as a 200-megapixel still.
    const stub = sharpStub({ metadata: { width: 1000, height: 1000, pages: 200 } });

    expect(await createSharpImagePipeline({ sharp: stub.sharp }).process(SOURCE, 'image/gif')).toEqual(
      { ok: false, problem: 'image_dimensions_too_large' },
    );
  });

  it('reports a codec that refused partway through as unreadable, never throwing', async () => {
    const stub = sharpStub({ failOn: ['webp'] });

    await expect(
      createSharpImagePipeline({ sharp: stub.sharp }).process(SOURCE, 'image/png'),
    ).resolves.toEqual({ ok: false, problem: 'image_unreadable' });
  });
});

describe('cut', () => {
  it('cuts every requested size onto its exact canvas', async () => {
    const stub = sharpStub();

    const outputs = await createSharpImagePipeline({ sharp: stub.sharp }).cut(
      SOURCE,
      CATALOG_RENDITIONS,
    );

    expect(outputs.map((output) => output.spec.name)).toEqual(
      CATALOG_RENDITIONS.map((spec) => spec.name),
    );
    // `contain` and not `cover`: a catalog shot is usually TALLER than 4:3, so cover
    // throws away the top and bottom of the product — the exact pixels the photo is
    // of. The canvas is still exactly the declared size, which is what lets the
    // srcset width descriptors come from the spec list alone.
    const canvases = argsOf(stub.calls, 'resize').slice(0, CATALOG_RENDITIONS.length);
    expect(canvases[0]).toMatchObject({ width: 320, height: 240, fit: 'contain' });
    expect(canvases.at(-1)).toMatchObject({ width: 256, height: 256, fit: 'contain' });
  });

  it("pads with the photo's OWN backdrop, sampled from the pixel trim measured", async () => {
    const stub = sharpStub({ cornerPixel: [139, 58, 26, 255] });

    await createSharpImagePipeline({ sharp: stub.sharp }).cut(SOURCE, CATALOG_RENDITIONS);

    const backdrop = { r: 139, g: 58, b: 26, alpha: 1 };
    expect(trimBackground(stub.calls)).toEqual(backdrop);
    // The padding put back is by construction the colour that was taken away, so it
    // reads as the photo rather than as a letterbox.
    expect(argsOf(stub.calls, 'resize')[0]).toMatchObject({ background: backdrop });
  });

  it('pads a cut-out PNG with TRANSPARENCY, not with white', async () => {
    const stub = sharpStub({ cornerPixel: [0, 0, 0, 0] });

    await createSharpImagePipeline({ sharp: stub.sharp }).cut(SOURCE, CATALOG_RENDITIONS);

    expect(trimBackground(stub.calls)).toEqual({ r: 0, g: 0, b: 0, alpha: 0 });
  });

  it('trims to the subject through a LOSSLESS intermediate', async () => {
    // The trimmed buffer is re-encoded once per rendition; a lossy intermediate
    // would compound its artifacts five times over.
    const stub = sharpStub();

    await createSharpImagePipeline({ sharp: stub.sharp }).cut(SOURCE, CATALOG_RENDITIONS);

    expect(stub.calls.map((call) => call.op)).toContain('png');
  });

  it('declines an ANIMATED source rather than flattening it', async () => {
    // sharp models an animation as a vertical filmstrip, so trimming and padding
    // would operate on the strip. An empty list is what routes it to the flat key,
    // where it keeps its frames.
    const stub = sharpStub({ metadata: { width: 400, height: 400, pages: 12 } });

    expect(await createSharpImagePipeline({ sharp: stub.sharp }).cut(SOURCE, CATALOG_RENDITIONS)).toEqual(
      [],
    );
  });

  it('refuses a decompression bomb from the HEADER, before anything is decoded', async () => {
    // The regression for an adversarial finding. `process` enforced the ceiling and
    // the writer runs the two halves under one `Promise.all`, so the refusal arrived
    // AFTER this path had read the corner pixel, trimmed the full image and encoded
    // five crops — a probe on a 30000×30000 declared source reached `extract`, `trim`
    // and five `webp`s before the 413. The ceiling bounded the status code, not the
    // memory.
    const stub = sharpStub({ metadata: { width: 30_000, height: 30_000, pages: 1 } });

    const outputs = await createSharpImagePipeline({ sharp: stub.sharp }).cut(
      SOURCE,
      CATALOG_RENDITIONS,
    );

    expect(outputs).toEqual([]);
    const ops = stub.calls.map((call) => call.op);
    expect(ops).toEqual(['metadata']);
    for (const forbidden of ['extract', 'trim', 'resize', 'webp']) {
      expect(ops, forbidden).not.toContain(forbidden);
    }
  });

  it('counts an animation frame by frame against that ceiling too', async () => {
    // Declined for being animated as well, but the budget is what stops a 200-frame
    // source that is only 1000x1000 per frame.
    const stub = sharpStub({ metadata: { width: 8_000, height: 8_000, pages: 1 } });

    expect(
      await createSharpImagePipeline({ sharp: stub.sharp, maxPixels: 1_000_000 }).cut(
        SOURCE,
        CATALOG_RENDITIONS,
      ),
    ).toEqual([]);
    expect(stub.calls.map((call) => call.op)).toEqual(['metadata']);
  });

  it('honors a raised ceiling rather than a constant of its own', async () => {
    const stub = sharpStub({ metadata: { width: 9_000, height: 9_000, pages: 1 } });

    expect(
      await createSharpImagePipeline({ sharp: stub.sharp, maxPixels: 200_000_000 }).cut(
        SOURCE,
        CATALOG_RENDITIONS,
      ),
    ).toHaveLength(CATALOG_RENDITIONS.length);
  });

  it('refuses a source with no dimensions rather than trusting it', async () => {
    const stub = sharpStub({ metadata: { width: 0, height: 0, pages: 1 } });

    expect(
      await createSharpImagePipeline({ sharp: stub.sharp }).cut(SOURCE, CATALOG_RENDITIONS),
    ).toEqual([]);
  });

  it('returns nothing for bytes it cannot read at all', async () => {
    const stub = sharpStub({ failOn: ['metadata'] });

    expect(await createSharpImagePipeline({ sharp: stub.sharp }).cut(SOURCE, CATALOG_RENDITIONS)).toEqual(
      [],
    );
  });

  it('falls back to the UNTRIMMED image when a trim eats the picture', async () => {
    // A photo that is one flat colour, or whose subject matches its backdrop, trims
    // to nothing. Worse framing beats no product — so the set is still cut.
    const stub = sharpStub({ metadata: { width: 4, height: 4, pages: 1 } });

    const outputs = await createSharpImagePipeline({ sharp: stub.sharp }).cut(
      SOURCE,
      CATALOG_RENDITIONS,
    );

    expect(outputs).toHaveLength(CATALOG_RENDITIONS.length);
  });

  it('survives a trim the codec refuses outright', async () => {
    const stub = sharpStub({ failOn: ['trim'] });

    expect(
      await createSharpImagePipeline({ sharp: stub.sharp }).cut(SOURCE, CATALOG_RENDITIONS),
    ).toHaveLength(CATALOG_RENDITIONS.length);
  });

  it('refuses a PARTIAL set wholesale when one size fails', async () => {
    // The srcset builder reads the spec list either way, so a browser would be
    // handed a key with no object behind it and draw the broken-image glyph.
    const stub = sharpStub({ failWebpAt: 3 });

    expect(await createSharpImagePipeline({ sharp: stub.sharp }).cut(SOURCE, CATALOG_RENDITIONS)).toEqual(
      [],
    );
  });
});

describe('passthroughImagePipeline', () => {
  it('stores the bytes as they arrived and cuts nothing', async () => {
    const pipeline = passthroughImagePipeline();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(await pipeline.process(png, 'image/png')).toEqual({
      ok: true,
      image: { bytes: png, contentType: 'image/png' },
    });
    expect(await pipeline.cut(png, CATALOG_RENDITIONS)).toEqual([]);
    expect(pipeline.cutsRenditions).toBe(false);
  });

  it('still refuses bytes that are not the format they claim', async () => {
    // The magic-number check is what stops an upload being a way to park arbitrary
    // content at a world-readable URL, and that is not the resizer's job to provide.
    const pipeline = passthroughImagePipeline();

    expect(await pipeline.process(new Uint8Array([1, 2, 3]), 'image/png')).toEqual({
      ok: false,
      problem: 'content_mismatch',
    });
  });
});
