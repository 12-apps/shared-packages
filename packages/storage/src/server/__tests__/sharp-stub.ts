import type { Rgba, SharpImage, SharpMetadata, SharpModule } from '../pipeline/sharp-module';

/**
 * A `sharp` stand-in that records the chain it was asked to build.
 *
 * The pipeline takes the sharp MODULE as an argument, so its logic can be driven
 * without libvips — which is the point of the port and not merely convenient: what
 * these suites assert is the DECISIONS (does it enlarge, does it flatten an
 * animation, does it pad with the photo's own backdrop, does it keep a partial set)
 * and every one of those is a call this stub can record exactly. Whether libvips
 * resamples correctly is libvips' own test suite.
 */

interface SharpCall {
  op: string;
  arg?: unknown;
}

interface SharpStubOptions {
  metadata?: SharpMetadata;
  /** Corner pixel the trim colour is read from. Default opaque white. */
  cornerPixel?: readonly number[];
  /** Byte length each `toBuffer` answers. Default 10. */
  outputLength?: number;
  /** Ops that should throw when reached, e.g. `['trim']`. */
  failOn?: readonly string[];
  /** Fail only the Nth `webp()` call (1-based), for a partial-set test. */
  failWebpAt?: number;
}

interface SharpStub {
  sharp: SharpModule;
  /** Every op, in order, across every chain built. */
  calls: SharpCall[];
  /** The `animated` flag each chain was constructed with. */
  constructions: (boolean | undefined)[];
}

export function sharpStub(options: SharpStubOptions = {}): SharpStub {
  const calls: SharpCall[] = [];
  const constructions: (boolean | undefined)[] = [];
  const metadata = options.metadata ?? { width: 2000, height: 1500, pages: 1 };
  const corner = options.cornerPixel ?? [255, 255, 255, 255];
  const outputLength = options.outputLength ?? 10;
  const failOn = new Set(options.failOn ?? []);
  // Counters live on a container, never as closed-over `let`s reassigned from
  // inside a stub — the pattern the flakiness gate rejects.
  const counters = { webp: 0 };

  function record(op: string, arg?: unknown): void {
    calls.push(arg === undefined ? { op } : { op, arg });
    if (failOn.has(op)) throw new Error(`stub: ${op} refused`);
  }

  const sharp: SharpModule = (_input, init = undefined) => {
    constructions.push(init?.animated);
    const chain = { raw: false };
    const image: SharpImage = {
      metadata: async () => {
        record('metadata');
        return metadata;
      },
      resize: (resizeOptions) => {
        record('resize', resizeOptions);
        return image;
      },
      extract: (region) => {
        record('extract', region);
        return image;
      },
      ensureAlpha: () => {
        record('ensureAlpha');
        return image;
      },
      raw: () => {
        record('raw');
        chain.raw = true;
        return image;
      },
      trim: (trimOptions) => {
        record('trim', trimOptions);
        return image;
      },
      png: () => {
        record('png');
        return image;
      },
      webp: (webpOptions) => {
        counters.webp += 1;
        record('webp', webpOptions);
        if (options.failWebpAt === counters.webp) throw new Error('stub: webp refused');
        return image;
      },
      toFormat: (format) => {
        record('toFormat', format);
        return image;
      },
      toBuffer: async () => {
        record('toBuffer');
        // The raw read is the corner-pixel probe; everything else is "some encoded
        // bytes", whose only interesting property is the length.
        return chain.raw ? new Uint8Array(corner) : new Uint8Array(outputLength);
      },
    };
    return image;
  };

  return { sharp, calls, constructions };
}

/** The argument of the first call to `op`, for an assertion about one option. */
export function argOf(calls: readonly SharpCall[], op: string): unknown {
  return calls.find((call) => call.op === op)?.arg;
}

/** Every argument passed to `op`, in order. */
export function argsOf(calls: readonly SharpCall[], op: string): unknown[] {
  return calls.filter((call) => call.op === op).map((call) => call.arg);
}

/** The RGBA a `trim` was asked for — the padding colour the crops will use. */
export function trimBackground(calls: readonly SharpCall[]): Rgba | undefined {
  return (argOf(calls, 'trim') as { background: Rgba } | undefined)?.background;
}
