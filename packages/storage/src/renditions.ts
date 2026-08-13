/**
 * The DERIVED sizes of a stored photo — the crops a storefront actually draws,
 * cut once at upload instead of by every visitor's browser.
 *
 * Downscaling the uncropped object fixes the MEGABYTE. It does not fix the
 * FRAMING, and the framing is what a buyer sees: a card's media block is a 4:3
 * box, a supplier's photo is a 600×1200 bottle on white, and drawn `contain`
 * the bottle occupies a third of the box with two flat columns beside it. The
 * other half of the same waste is the byte — a 4:3 hero and a 64px thumbnail
 * both served that one 1280px object.
 *
 * So an upload writes a SET:
 *
 *   <prefix>/<scope>/<uuid>/full.webp        the whole picture, uncropped
 *   <prefix>/<scope>/<uuid>/card-320.webp    4:3, one card on a phone
 *   <prefix>/<scope>/<uuid>/card-640.webp    4:3, a retina card / phone hero
 *   <prefix>/<scope>/<uuid>/card-1280.webp   4:3, a retina hero on a desktop
 *   <prefix>/<scope>/<uuid>/thumb-128.webp   1:1, a 64px row thumbnail
 *   <prefix>/<scope>/<uuid>/thumb-256.webp   1:1, the same row at 2×
 *
 * ONE 4:3 FAMILY SERVES BOTH the card and the hero, because both draw a 4:3
 * box. Three widths plus a `sizes` attribute is how "mobile and desktop" is
 * expressed on the web; cutting a `detail-640` next to an identical `card-640`
 * would double the objects to say the same thing.
 *
 * The list is in ONE place so the writer, the URL builder and the reclaimer
 * cannot disagree about what exists.
 */

/** Which `srcset` family a size belongs to. */
export type RenditionFamily = 'card' | 'thumb';

/** One derived size: the object's name suffix and the exact canvas it fills. */
export interface RenditionSpec {
  /** File stem — the key is `<set>/<name>.webp`. */
  name: string;
  width: number;
  height: number;
  family: RenditionFamily;
}

/**
 * The default rendition set.
 *
 * The widths are drawn sizes at 1× and 2×: a card is ~165–250 CSS px, a hero is
 * the modal's full width (~390 on a phone, ~600 on a desktop), and a row
 * thumbnail is 64. A host that draws different boxes passes its own list.
 */
export const CATALOG_RENDITIONS: readonly RenditionSpec[] = [
  { name: 'card-320', width: 320, height: 240, family: 'card' },
  { name: 'card-640', width: 640, height: 480, family: 'card' },
  { name: 'card-1280', width: 1280, height: 960, family: 'card' },
  { name: 'thumb-128', width: 128, height: 128, family: 'thumb' },
  { name: 'thumb-256', width: 256, height: 256, family: 'thumb' },
];

/** Every rendition is WebP, whatever the source was. */
export const RENDITION_CONTENT_TYPE = 'image/webp';

/** A cut rendition: which spec it satisfies and the bytes to store. */
export interface RenditionOutput {
  spec: RenditionSpec;
  bytes: Uint8Array;
}

/** The distinct families in a rendition list, in first-seen order. */
export function renditionFamilies(
  specs: readonly RenditionSpec[],
): readonly RenditionFamily[] {
  return [...new Set(specs.map((spec) => spec.family))];
}
