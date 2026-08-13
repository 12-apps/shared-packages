// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CATALOG_IMAGE_PROFILE,
  optimizeImage,
  resetWebpSupportProbe,
  scaledSize,
  webpName,
} from '../optimize-image';

/**
 * The browser-side shrink.
 *
 * jsdom has no canvas and no `createImageBitmap`, so both are installed here — which
 * is also the honest shape of the test: every pass-through below is a real browser
 * state (no decoder, no WebP encoder, a corrupt file), and the claim in each case is
 * that the ORIGINAL file survives. An upload must never be made worse, and never
 * made slower to fail.
 */

interface FakeCanvas {
  width: number;
  height: number;
  getContext(): object | null;
  toDataURL(type: string): string;
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
}

interface CanvasOptions {
  /** Whether this browser's canvas can emit WebP. */
  webp?: boolean;
  /** Byte length of the encoded blob. */
  encodedSize?: number;
  /** Whether `toBlob` exists at all. */
  blob?: boolean;
  /** Whether a 2d context can be had. */
  context?: boolean;
}

/**
 * Install a canvas for ONE case, and hand back what it recorded.
 *
 * Per case rather than a module-level object every test mutates: the recorded
 * `drawn` sizes are the whole assertion here, and a shared container is exactly the
 * order dependency the flakiness gate rejects.
 */
function installCanvas(options: CanvasOptions = {}): { drawn: { width: number; height: number }[] } {
  const webp = options.webp !== false;
  const encodedSize = options.encodedSize ?? 100;
  const hasBlob = options.blob !== false;
  const hasContext = options.context !== false;
  const drawn: { width: number; height: number }[] = [];
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return {} as HTMLElement;
    const canvas: FakeCanvas = {
      width: 0,
      height: 0,
      getContext: () =>
        hasContext
          ? {
              imageSmoothingEnabled: false,
              imageSmoothingQuality: '',
              drawImage: (_source: unknown, _x: number, _y: number, w: number, h: number) => {
                drawn.push({ width: w, height: h });
              },
            }
          : null,
      toDataURL: (type: string) =>
        webp && type === 'image/webp' ? 'data:image/webp;base64,x' : 'data:image/png;base64,x',
    };
    if (hasBlob) {
      canvas.toBlob = (callback, type) => {
        callback(new Blob([new Uint8Array(encodedSize)], { type: type ?? 'image/webp' }));
      };
    }
    return canvas as unknown as HTMLElement;
  }) as typeof document.createElement);
  return { drawn };
}

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

function installDecoder(size: { width: number; height: number } | null): void {
  const bitmap = size
    ? ({ ...size, close: () => undefined } as unknown as ImageBitmap)
    : null;
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    writable: true,
    value: bitmap ? () => Promise.resolve(bitmap) : () => Promise.reject(new Error('undecodable')),
  });
}

beforeEach(() => {
  resetWebpSupportProbe();
  installDecoder({ width: 2000, height: 1500 });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'createImageBitmap');
});

describe('scaledSize', () => {
  it('leaves an image that already fits alone', () => {
    expect(scaledSize(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });

  it('scales the LONGEST edge to the bound and keeps the aspect ratio', () => {
    expect(scaledSize(2000, 1000, 1280)).toEqual({ width: 1280, height: 640 });
    expect(scaledSize(1000, 2000, 1280)).toEqual({ width: 640, height: 1280 });
  });

  it('never produces a zero-pixel side from an extreme aspect ratio', () => {
    // `drawImage` onto a zero-height canvas throws, taking the upload with it.
    expect(scaledSize(4000, 3, 1280).height).toBe(1);
  });
});

describe('webpName', () => {
  it('swaps the extension rather than appending to it', () => {
    expect(webpName('photo.png')).toBe('photo.webp');
  });

  it('gives an extensionless name one', () => {
    expect(webpName('photo')).toBe('photo.webp');
  });
});

describe('optimizeImage', () => {
  it('downscales an oversized photo to the profile bound', async () => {
    const canvas = installCanvas();

    const result = await optimizeImage(file('p.png', 'image/png', 4000));

    expect(canvas.drawn).toEqual([{ width: 1280, height: 960 }]);
    expect(result.type).toBe('image/webp');
    expect(result.name).toBe('p.webp');
    expect(result.size).toBe(100);
  });

  it('re-encodes an image that already fits, without resizing it', async () => {
    const canvas = installCanvas();
    installDecoder({ width: 400, height: 300 });

    await optimizeImage(file('p.png', 'image/png', 4000));

    expect(canvas.drawn).toEqual([{ width: 400, height: 300 }]);
  });

  it('keeps the ORIGINAL when re-encoding would not make it smaller', async () => {
    // An already-optimized 40 KB WebP can round-trip larger. This comparison is what
    // makes running the whole thing unconditionally safe.
    installCanvas({ encodedSize: 5000 });
    const original = file('p.png', 'image/png', 4000);

    expect(await optimizeImage(original)).toBe(original);
  });

  it('passes a GIF through untouched', async () => {
    // A canvas holds one frame, so re-encoding would silently turn an animation into
    // a still. Better large than broken.
    const canvas = installCanvas();
    const gif = file('a.gif', 'image/gif', 4000);

    expect(await optimizeImage(gif)).toBe(gif);
    expect(canvas.drawn).toEqual([]);
  });

  it('passes a type the upload would refuse through untouched', async () => {
    // An unrecognised type is the upload layer's rejection to report, not ours to
    // mangle first.
    installCanvas();
    const zip = file('a.zip', 'application/zip', 4000);

    expect(await optimizeImage(zip)).toBe(zip);
  });

  it('does not attempt to decode a file large enough to crash the tab', async () => {
    const canvas = installCanvas();
    const huge = file('p.png', 'image/png', 40 * 1024 * 1024);

    expect(await optimizeImage(huge)).toBe(huge);
    expect(canvas.drawn).toEqual([]);
  });

  it('returns the original when the decoder refuses the file', async () => {
    installCanvas();
    installDecoder(null);
    const corrupt = file('p.png', 'image/png', 4000);

    expect(await optimizeImage(corrupt)).toBe(corrupt);
  });

  it('returns the original, promptly, on an engine with no createImageBitmap', async () => {
    // The `<img>`-element fallback is deliberately absent: such an element can leave
    // BOTH onload and onerror unfired, which would hang the upload for ever.
    installCanvas();
    Reflect.deleteProperty(globalThis, 'createImageBitmap');
    const original = file('p.png', 'image/png', 4000);

    expect(await optimizeImage(original)).toBe(original);
  });

  it('returns the original when the canvas refuses to encode', async () => {
    installCanvas({ blob: false });
    const original = file('p.png', 'image/png', 4000);

    expect(await optimizeImage(original)).toBe(original);
  });

  it('returns the original when there is no 2d context at all', async () => {
    installCanvas({ context: false });
    const original = file('p.png', 'image/png', 4000);

    expect(await optimizeImage(original)).toBe(original);
  });

  it('keeps a transparent PNG as a PNG when the browser cannot encode WebP', async () => {
    // A JPEG has no alpha, so "optimizing" a cut-out product photo that way would
    // hand the storefront a black rectangle behind every bottle.
    installCanvas({ webp: false });

    const result = await optimizeImage(file('p.png', 'image/png', 4000));

    expect(result.type).toBe('image/png');
    expect(result.name).toBe('p.png');
  });

  it('honors a caller-supplied profile', async () => {
    const canvas = installCanvas();

    await optimizeImage(file('p.png', 'image/png', 4000), {
      ...CATALOG_IMAGE_PROFILE,
      maxEdge: 400,
    });

    expect(canvas.drawn).toEqual([{ width: 400, height: 300 }]);
  });
});
