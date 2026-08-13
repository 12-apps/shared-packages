/**
 * The slice of `sharp`'s API this package uses, described STRUCTURALLY.
 *
 * The pipeline takes the module as an argument instead of importing it, so
 * `sharp` is neither a dependency nor a peer of this package: a host that wants
 * renditions passes the module it already has, and every other consumer installs
 * nothing. Describing the surface here rather than importing sharp's types keeps
 * that true for the type-checker too — a package that imported the types would
 * make `@types/sharp` a hard requirement of compiling it.
 *
 * `sharp`'s own `Sharp` interface is wider than this in every direction, so the
 * real module satisfies it by structural width subtyping; nothing here needs to
 * be kept in step with sharp's version except when this file starts calling
 * something new.
 */

/** An RGBA colour, in the shape sharp's `background` option takes. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

export interface SharpMetadata {
  width?: number | undefined;
  height?: number | undefined;
  /** Frames in an animation. 1 (or absent) for a still. */
  pages?: number | undefined;
}

export interface SharpResizeOptions {
  width?: number | undefined;
  height?: number | undefined;
  fit?: 'inside' | 'contain' | undefined;
  background?: Rgba | undefined;
  withoutEnlargement?: boolean | undefined;
}

export interface SharpImage {
  metadata(): Promise<SharpMetadata>;
  resize(options: SharpResizeOptions): SharpImage;
  extract(region: { left: number; top: number; width: number; height: number }): SharpImage;
  ensureAlpha(): SharpImage;
  raw(): SharpImage;
  trim(options: { background: Rgba; threshold: number }): SharpImage;
  png(): SharpImage;
  webp(options: { quality: number }): SharpImage;
  toFormat(format: string): SharpImage;
  toBuffer(): Promise<Uint8Array>;
}

/** `sharp(bytes, { animated })`. */
export type SharpModule = (
  input: Uint8Array,
  options?: { animated?: boolean },
) => SharpImage;
