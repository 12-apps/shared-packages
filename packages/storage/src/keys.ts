import { EXTENSION_BY_CONTENT_TYPE } from './content-types';

/**
 * The object key: what it looks like, what its SHAPE promises, and which
 * tenant it belongs to.
 *
 * ## Server-minted, always
 *
 * The key is what lands in the host's database and what a serve route resolves,
 * and stored objects are world-readable (a store's logo is printed in its own
 * storefront HTML). A caller that could choose its own key could therefore
 * write over any object whose URL it can read.
 *
 * ## Two shapes, and the difference is a FACT about the object
 *
 * A photo stored WITH its derived crops is a directory of objects sharing a
 * uuid, and the key saved on the row names the uncropped member:
 *
 *     products/<scope>/<uuid>/full.webp        ← the key on the row
 *     products/<scope>/<uuid>/card-320.webp    ← its siblings
 *     products/<scope>/<uuid>/thumb-128.webp
 *
 * A photo stored ALONE keeps the flat shape:
 *
 *     products/<scope>/<uuid>.webp
 *
 * So the shape is a truthful answer to "may I ask for this photo's 4:3 card
 * crop?" ({@link ObjectKey.hasRenditions}) — and that is deliberately the ONLY
 * place that question is answered. The alternative is a column recording which
 * derivatives exist, on the row and on every draft, change request, recycle-bin
 * snapshot and version the row is copied into, kept in step with the bucket by
 * nothing. A key that describes its own storage cannot fall out of step, and a
 * consumer handed a key with no set simply asks for no crops.
 *
 * ## The SCOPE segment is the tenant boundary
 *
 * `<scope>` is the tenant the object belongs to, and it is what makes
 * cross-tenant reclaim a parse rather than a query: `deleteIfOrphaned` refuses
 * a key whose scope is not the caller's before it consults any reference probe.
 * A scheme without it leaves "may this tenant delete this object?" answerable
 * only by proving no row of THEIRS points at it — which is true of every other
 * tenant's objects too.
 *
 * UNSCOPED keys parse as well, with `scope: null`, because an adopting host has
 * a table full of them. They are the reason `unscopedKeys` is a required
 * choice rather than a default (see `create-api-storage.ts`): for such a key
 * the structural guarantee above does not exist, and only the host's probes
 * stand between one tenant and another's bytes.
 *
 * The four shapes stay mutually unambiguous even when a scope is itself
 * uuid-shaped (a tenant id): a set key's leaf stem is always `full`, and a flat
 * key's leaf stem is always the object uuid, which is never the word `full`.
 */

/** Default top-level segment every key starts with. */
export const DEFAULT_KEY_PREFIX = 'products';

/** The member of a rendition set that holds the uncropped picture. */
const FULL_STEM = 'full';

/**
 * A legal scope segment.
 *
 * Deliberately narrower than "a tenant slug": the local-disk driver turns a key
 * into a filesystem path, so a segment that can carry `.`, `/` or whitespace is
 * a traversal waiting for a caller who assembles a key by hand. A host whose
 * tenant identifiers do not fit passes their id instead of their slug.
 */
const SCOPE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** A parsed object key. */
export interface ObjectKey {
  prefix: string;
  /** The tenant the object belongs to; `null` for a legacy unscoped key. */
  scope: string | null;
  /** The object's own uuid — shared by every member of a rendition set. */
  uuid: string;
  /** Extension of the uncropped object, which is not always `webp`. */
  extension: string;
  /** Was this photo stored with the crops a storefront draws? */
  hasRenditions: boolean;
}

/** Is `scope` usable as a key segment? Checked at mint time, not assumed. */
export function isLegalScope(scope: string): boolean {
  return SCOPE.test(scope);
}

/**
 * The four shapes, as anchored regexes built once per prefix.
 *
 * Regexes rather than a segment walk because the four are MUTUALLY EXCLUSIVE by
 * construction and that is the property worth making obvious: a set key's leaf
 * stem is the literal `full`, a flat key's is the object uuid, and a uuid is never
 * the word `full`. So the three-segment shapes — `<prefix>/<scope>/<uuid>.ext` and
 * `<prefix>/<uuid>/full.ext` — cannot both match one key, whether or not the scope
 * happens to be uuid-shaped itself.
 *
 * The scope group is always present and simply matches nothing on the unscoped
 * shapes, so a caller reads it the same way every time.
 */
interface KeyShape {
  re: RegExp;
  hasRenditions: boolean;
}

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SCOPE_SOURCE = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
const EXT_SOURCE = '[A-Za-z0-9]{2,4}';
const STEM_SOURCE = '[A-Za-z0-9][A-Za-z0-9_-]*';

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Built per prefix and cached: a key is parsed on every read of every row. */
const SHAPES = new Map<string, readonly KeyShape[]>();
const MEMBER_SHAPES = new Map<string, readonly RegExp[]>();

function shapesFor(prefix: string): readonly KeyShape[] {
  const cached = SHAPES.get(prefix);
  if (cached) return cached;
  const p = escapeRegExp(prefix);
  const shapes: readonly KeyShape[] = [
    // scoped set, scoped flat, unscoped set, unscoped flat
    { re: key(`${p}/(${SCOPE_SOURCE})/(${UUID_SOURCE})/${FULL_STEM}`), hasRenditions: true },
    { re: key(`${p}/(${SCOPE_SOURCE})/(${UUID_SOURCE})`), hasRenditions: false },
    { re: key(`${p}/()(${UUID_SOURCE})/${FULL_STEM}`), hasRenditions: true },
    { re: key(`${p}/()(${UUID_SOURCE})`), hasRenditions: false },
  ];
  SHAPES.set(prefix, shapes);
  return shapes;
}

/** `<body>.<ext>`, anchored and case-insensitive. */
function key(body: string): RegExp {
  return new RegExp(`^${body}\\.(${EXT_SOURCE})$`, 'i');
}

/**
 * The MEMBER shapes: a crop's leaf stem is `card-320`, which is deliberately not a
 * key any row may name.
 */
function memberShapesFor(prefix: string): readonly RegExp[] {
  const cached = MEMBER_SHAPES.get(prefix);
  if (cached) return cached;
  const p = escapeRegExp(prefix);
  const shapes: readonly RegExp[] = [
    new RegExp(
      `^${p}/(${SCOPE_SOURCE})/(${UUID_SOURCE})/(${STEM_SOURCE})\\.(${EXT_SOURCE})$`,
      'i',
    ),
    new RegExp(`^${p}/()(${UUID_SOURCE})/(${STEM_SOURCE})\\.(${EXT_SOURCE})$`, 'i'),
  ];
  MEMBER_SHAPES.set(prefix, shapes);
  return shapes;
}

/** A capture group, which the shapes above always define. */
function group(match: RegExpExecArray, index: number): string {
  return match[index] ?? '';
}

/**
 * Parse `key`, or `null` for anything this scheme did not mint.
 *
 * Total: every accepted key is one of the four shapes documented above, so a near
 * miss reads as "not ours" rather than as a photo whose crops five URLs promise and
 * no object backs.
 */
export function parseObjectKey(key: string, prefix = DEFAULT_KEY_PREFIX): ObjectKey | null {
  for (const shape of shapesFor(prefix)) {
    const match = shape.re.exec(key);
    if (match) {
      return {
        prefix,
        // Empty on the unscoped shapes, where the group matches nothing.
        scope: group(match, 1) || null,
        uuid: group(match, 2),
        extension: group(match, 3).toLowerCase(),
        hasRenditions: shape.hasRenditions,
      };
    }
  }
  return null;
}

/** Is `key` one this scheme minted — any of the four shapes? */
export function isObjectKey(key: string, prefix = DEFAULT_KEY_PREFIX): boolean {
  return parseObjectKey(key, prefix) !== null;
}

/** Does `key` name a photo that was stored with its derived crops? */
export function hasRenditions(key: string, prefix = DEFAULT_KEY_PREFIX): boolean {
  return parseObjectKey(key, prefix)?.hasRenditions ?? false;
}

/** How a key is minted: the tenant it belongs to and the stored format. */
export interface MintKeyInput {
  /** The tenant the object belongs to. */
  scope: string;
  /**
   * The type the object is ACTUALLY stored as — on a re-encoding pipeline that is
   * the produced type, not the one the caller declared. The extension here is what
   * the object is later served with, so minting from the declared type would label
   * a downscaled WebP `.png`.
   */
  contentType: string;
  prefix?: string;
  /** A caller-supplied uuid. Tests only; production mints one per upload. */
  uuid?: string;
}

function extensionFor(contentType: string): string {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!extension) {
    throw new Error(`Refusing to mint a key for an unsupported type: ${contentType}`);
  }
  return extension;
}

function assertScope(scope: string): void {
  if (!isLegalScope(scope)) {
    throw new Error(`Refusing to mint a key with an unsafe scope segment: ${scope}`);
  }
}

/**
 * Mint a STANDALONE object key: `<prefix>/<scope>/<uuid>.<ext>`.
 *
 * The shape for everything that is one picture and nothing more — a logo, an app
 * icon, and a photo whose source cannot be cropped frame by frame.
 */
export function mintObjectKey(input: MintKeyInput): string {
  assertScope(input.scope);
  const prefix = input.prefix ?? DEFAULT_KEY_PREFIX;
  return `${prefix}/${input.scope}/${input.uuid ?? crypto.randomUUID()}.${extensionFor(
    input.contentType,
  )}`;
}

/**
 * Mint the key for the uncropped member of a rendition SET:
 * `<prefix>/<scope>/<uuid>/full.<ext>`. Siblings are named from it by
 * {@link renditionKey}.
 */
export function mintObjectSetKey(input: MintKeyInput): string {
  assertScope(input.scope);
  const prefix = input.prefix ?? DEFAULT_KEY_PREFIX;
  const uuid = input.uuid ?? crypto.randomUUID();
  return `${prefix}/${input.scope}/${uuid}/${FULL_STEM}.${extensionFor(input.contentType)}`;
}

/**
 * The key of one sibling in `key`'s rendition set, or `null` for a key with no set.
 *
 * Null rather than a plausible-looking string: constructing a key for an object
 * nobody ever wrote is how a card ends up drawing the broken-image glyph.
 */
export function renditionKey(
  key: string,
  name: string,
  prefix = DEFAULT_KEY_PREFIX,
): string | null {
  if (!hasRenditions(key, prefix)) return null;
  return `${key.slice(0, key.lastIndexOf('/'))}/${name}.webp`;
}

/** One member of a stored photo — the uncropped object or any of its crops. */
export interface ObjectMemberKey {
  scope: string | null;
  uuid: string;
  /** `full`, `card-320`, or the uuid itself for a flat key. */
  stem: string;
  extension: string;
}

/**
 * Parse any MEMBER of a stored photo, crops included.
 *
 * The serve route needs this and {@link parseObjectKey} will not do: the two
 * questions are different — "is this a key I could have saved?" versus "is this an
 * object I could have written?" — and answering the second with the first would
 * 400 every crop in the catalog.
 */
export function parseObjectMemberKey(
  key: string,
  prefix = DEFAULT_KEY_PREFIX,
): ObjectMemberKey | null {
  const direct = parseObjectKey(key, prefix);
  if (direct) {
    return {
      scope: direct.scope,
      uuid: direct.uuid,
      stem: direct.hasRenditions ? FULL_STEM : direct.uuid,
      extension: direct.extension,
    };
  }
  for (const re of memberShapesFor(prefix)) {
    const match = re.exec(key);
    if (match) {
      return {
        scope: group(match, 1) || null,
        uuid: group(match, 2),
        stem: group(match, 3),
        extension: group(match, 4).toLowerCase(),
      };
    }
  }
  return null;
}

/**
 * Does `key` belong to `scope`?
 *
 * `unscopedKeys` decides the legacy case and has no safe default, which is why
 * the mount requires the host to choose it. `'accept'` means a key with no
 * scope segment is treated as in-scope — correct for a host whose existing rows
 * predate the scope segment, and the reason such a host still needs reference
 * probes. `'reject'` means only a key carrying this scope is ever touched.
 */
export function keyInScope(
  key: string,
  scope: string,
  unscopedKeys: 'accept' | 'reject',
  prefix = DEFAULT_KEY_PREFIX,
): boolean {
  const parsed = parseObjectKey(key, prefix);
  if (!parsed) return false;
  if (parsed.scope === null) return unscopedKeys === 'accept';
  return parsed.scope === scope;
}
