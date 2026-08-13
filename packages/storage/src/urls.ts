import { hasRenditions, renditionKey } from './keys';
import {
  CATALOG_RENDITIONS,
  renditionFamilies,
  type RenditionFamily,
  type RenditionSpec,
} from './renditions';

/**
 * Turning a stored KEY back into URLs a browser can load.
 *
 * The key, never the URL, is what lands in the host's database. Display code
 * resolves it through the ACTIVE driver, so the same row renders correctly
 * whether the object lives on a dev machine's disk or in a bucket behind a CDN —
 * and only the server knows which of those is running, which is why these run
 * server-side and the client receives finished `src`/`srcSet` pairs.
 */

/** How a key becomes a loadable URL. A driver's `publicUrl`, in practice. */
export type PublicUrlResolver = (key: string) => string;

/** One `srcset` family, ready to hand an `<img>`. */
export interface ImageRenditionSet {
  /**
   * What a browser without `srcset` support falls back to — a real member of
   * the family rather than the uncropped object, because a fallback that changed
   * the framing would make one card in a grid taller than the rest.
   */
  src: string;
  /** `w`-descriptor srcset — the widths are the canvases the crops were cut at. */
  srcSet: string;
}

/**
 * The derived crops of one photo, by the shape they are drawn in. `null` for a
 * photo stored without them — an animated source, a passthrough pipeline, or
 * anything uploaded before renditions existed — which every consumer reads as
 * "draw the uncropped object the way it has always been drawn".
 */
export type ImageSources = Readonly<Record<RenditionFamily, ImageRenditionSet>>;

/** Resolve a stored key, or an already-absolute URL, to something loadable. */
export function objectUrl(key: string | null, resolve: PublicUrlResolver): string | null {
  if (!key) return null;
  // A value that is already a URL is returned unchanged: a host migrating off
  // an older column may still hold absolute URLs beside real keys.
  if (/^https?:\/\//i.test(key)) return key;
  return resolve(key);
}

function familySet(
  key: string,
  family: RenditionFamily,
  specs: readonly RenditionSpec[],
  resolve: PublicUrlResolver,
  prefix: string | undefined,
): ImageRenditionSet {
  const members = specs.filter((spec) => spec.family === family);
  // Non-null throughout: `hasRenditions(key)` is the caller's precondition, and
  // `family` came from this same spec list.
  const url = (spec: RenditionSpec): string =>
    resolve(renditionKey(key, spec.name, prefix) as string);
  const first = members[0] as RenditionSpec;
  return {
    // The SMALLEST of the family: `src` is only reached without srcset support,
    // and over-fetching is the worse of the two ways to be wrong there.
    src: url(first),
    srcSet: members.map((spec) => `${url(spec)} ${spec.width}w`).join(', '),
  };
}

export interface ImageSourcesOptions {
  specs?: readonly RenditionSpec[];
  prefix?: string;
}

/**
 * The crop families stored beside `key`, or `null` when it has none.
 *
 * Derived from the key's SHAPE alone — see `keys.ts` for why that is a truthful
 * answer and not a guess.
 */
export function imageSources(
  key: string | null,
  resolve: PublicUrlResolver,
  options: ImageSourcesOptions = {},
): ImageSources | null {
  const specs = options.specs ?? CATALOG_RENDITIONS;
  if (!key || !hasRenditions(key, options.prefix)) return null;
  return Object.fromEntries(
    renditionFamilies(specs).map((family) => [
      family,
      familySet(key, family, specs, resolve, options.prefix),
    ]),
  ) as ImageSources;
}

/**
 * {@link objectUrl} with a cache-busting stamp appended.
 *
 * Exists for an app icon, where a stable URL is a bug rather than a nicety: a
 * manifest and its icons are cached hard, and an ALREADY-INSTALLED home-screen
 * icon is the last asset a device re-fetches — so a store that replaces its icon
 * keeps showing the old one on precisely the devices that matter, with nothing
 * on screen to explain it.
 *
 * The separator is chosen rather than assumed: a CDN base may legitimately carry
 * query parameters of its own, and a blind `?` would produce a URL with two.
 */
export function versionedObjectUrl(
  key: string | null,
  version: string | null,
  resolve: PublicUrlResolver,
): string | null {
  const url = objectUrl(key, resolve);
  if (!url || !version) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}
