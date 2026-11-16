import {
  centsFromMajor,
  type CatalogueReadNotice,
  type CatalogueReadWarning,
  type CatalogueSnapshotItem,
  type CatalogueSnapshotOption,
  type CatalogueSnapshotOptionGroup,
} from "../core/catalogue-read-port";

/**
 * iFood's catalogue answer mapped into the engine's {@link CatalogueSnapshotItem}
 * (FUT-951). Pure and offline: `./catalogue-read.ts` makes the calls.
 *
 * The shapes are the Catalog API v2.0's `PUT /items` payload, which the
 * portal's Introduction shows whole (read 2026-11-16): an `item` (id, type,
 * categoryId, status, `price { value }`, externalCode), `products` (id, name,
 * description, externalCode, and `optionGroups: [{ id, min, max }]` linking a
 * product to its groups), `optionGroups` (id, name, status, `optionIds`) and
 * `options` (id, `productId` naming the product that holds its name, status,
 * `price { value }`). The package README's "Catalogue reading" table marks
 * each fact CONFIRMED with its URL or ESTIMATED. ESTIMATED here, and said
 * beside each use:
 * - that `GET /categories/{categoryId}/items` answers the same four lists
 *   (`items` plural) the PUT takes;
 * - that `item.productId` names the item's product (the field the push sends);
 * - that `products[].imagePath` holds the photo, a path under
 *   {@link IFOOD_IMAGE_BASE_URL}.
 */

/**
 * Where iFood serves a catalogue photo's `imagePath`. ESTIMATED: the Catalog
 * pages read name `imagePath` but not its host; this is the host iFood's own
 * app loads dish photos from. A path that is already an absolute https URL is
 * used as it is.
 */
export const IFOOD_IMAGE_BASE_URL = "https://static-images.ifood.com.br/image/upload/t_high/pratos/";

type Json = Record<string, unknown>;

export const record = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;

export const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/**
 * The objects of a JSON array, and every other entry it held (a string, a
 * number, a nested array), so the caller can SAY what it could not read rather
 * than lose it. Not an array: no entries, nothing else.
 */
export function entriesOf(value: unknown): { entries: Json[]; others: unknown[] } {
  const entries: Json[] = [];
  const others: unknown[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const object = record(entry);
    if (object) entries.push(object);
    else others.push(entry);
  }
  return { entries, others };
}

/**
 * The lookup lists (`products`, `optionGroups`, `options`) keep only objects
 * with an id: an entry is only ever reached through an id that names it, and a
 * reference that finds nothing is warned about where it is made
 * (OPTION_GROUP_UNREADABLE, OPTION_UNREADABLE, or the item's ITEM_UNREADABLE).
 */
const list = (value: unknown): Json[] => entriesOf(value).entries;

/** iFood's `status`: anything but UNAVAILABLE is on sale (an absent status included). */
export const availableOf = (status: unknown): boolean => status !== "UNAVAILABLE";

/** The four lists of one category's answer, each by id. */
interface IfoodCatalogueIndex {
  products: Map<string, Json>;
  optionGroups: Map<string, Json>;
  options: Map<string, Json>;
}

const byId = (entries: Json[]): Map<string, Json> =>
  new Map(entries.flatMap((entry) => (text(entry.id) ? [[text(entry.id) as string, entry] as const] : [])));

export function indexOf(answer: Json): IfoodCatalogueIndex {
  return { products: byId(list(answer.products)), optionGroups: byId(list(answer.optionGroups)), options: byId(list(answer.options)) };
}

const priceCentsOf = (price: unknown): number | null => centsFromMajor(record(price)?.value);

const warning = (code: CatalogueReadWarning["code"], subject: string | null, detail: unknown = null): CatalogueReadWarning => ({
  code,
  subject,
  detail: detail === null || detail === undefined ? null : JSON.stringify(detail),
});

/** The photo's absolute URL; a warning when a reference is there but cannot be resolved. */
export function photoOf(imagePath: unknown, subject: string | null): { url: string | null; warning?: CatalogueReadWarning } {
  if (imagePath === undefined || imagePath === null || imagePath === "") return { url: null };
  const path = text(imagePath);
  if (path === null) return { url: null, warning: warning("PHOTO_UNREADABLE", subject, imagePath) };
  if (/^https:\/\//i.test(path)) return { url: path };
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return { url: null, warning: warning("PHOTO_UNREADABLE", subject, path) };
  return { url: `${IFOOD_IMAGE_BASE_URL}${urlSafePath(path.replace(/^\/+/, ""))}` };
}

/**
 * The path as a URL path: kept as it is when it is already one (an encoded
 * `%20` stays `%20`, never `%2520`); only a character a URL may not carry
 * (a space, a quote, a non-ASCII letter) is encoded, and a `%` that starts no
 * escape becomes `%25`.
 */
function urlSafePath(path: string): string {
  return path
    .replace(/%(?![0-9A-Fa-f]{2})/g, "%25")
    .replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/%]/g, (character) => encodeURIComponent(character));
}

/** The words and photo of an item or option: its product's (`productId`), else its own. */
interface Described {
  name: string | null;
  description: string | null;
  externalCode: string | null;
  imagePath: unknown;
}

function describedBy(index: IfoodCatalogueIndex, own: Json): Described {
  const product = index.products.get(text(own.productId) ?? "") ?? {};
  return {
    name: text(product.name) ?? text(own.name),
    description: text(product.description) ?? text(own.description),
    externalCode: text(own.externalCode) ?? text(product.externalCode),
    imagePath: product.imagePath ?? own.imagePath,
  };
}

/** The photo's URL, its warning (if any) pushed onto `warnings`. */
function photoInto(imagePath: unknown, subject: string | null, warnings: CatalogueReadWarning[]): string | null {
  const photo = photoOf(imagePath, subject);
  if (photo.warning) warnings.push(photo.warning);
  return photo.url;
}

/** One option of a group, or the warning that leaves it out. */
function optionOf(id: string, index: IfoodCatalogueIndex, warnings: CatalogueReadWarning[]): CatalogueSnapshotOption | null {
  const option = index.options.get(id);
  const described = option ? describedBy(index, option) : null;
  if (!option || !described || described.name === null) {
    warnings.push(warning("OPTION_UNREADABLE", id, option));
    return null;
  }
  const priceDeltaCents = priceCentsOf(option.price);
  if (priceDeltaCents === null) warnings.push(warning("OPTION_PRICE_MISSING", id, option.price));
  return {
    externalId: id,
    externalCode: described.externalCode,
    name: described.name,
    description: described.description,
    priceDeltaCents,
    photoUrl: photoInto(described.imagePath, id, warnings),
    available: availableOf(option.status),
  };
}

/** A group's bounds, when they make sense: whole numbers, 0 <= min <= max, max >= 1. */
function boundsOf(link: Json, group: Json): { min: number; max: number } | null {
  const min = link.min ?? group.min ?? 0;
  const max = link.max ?? group.max;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
  const [low, high] = [min as number, max as number];
  return low >= 0 && high >= 1 && high >= low ? { min: low, max: high } : null;
}

/** A group's option ids; an entry that is not an id is an OPTION_UNREADABLE warning, never dropped. */
function idsOf(groupId: string, value: unknown, warnings: CatalogueReadWarning[]): string[] {
  const ids: string[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const id = text(entry);
    if (id === null) warnings.push(warning("OPTION_UNREADABLE", groupId, entry));
    else ids.push(id);
  }
  return ids;
}

/** One group a product links to (`products[].optionGroups[]`), or the warning that leaves it out. */
function groupOf(link: Json, index: IfoodCatalogueIndex, warnings: CatalogueReadWarning[]): CatalogueSnapshotOptionGroup | null {
  const id = text(link.id);
  const group = id === null ? undefined : index.optionGroups.get(id);
  const bounds = group ? boundsOf(link, group) : null;
  const name = text(group?.name);
  if (id === null || !group || name === null || bounds === null) {
    warnings.push(warning("OPTION_GROUP_UNREADABLE", id, { link, group }));
    return null;
  }
  const options = idsOf(id, group.optionIds, warnings).flatMap((optionId) => optionOf(optionId, index, warnings) ?? []);
  if (options.length === 0) {
    warnings.push(warning("OPTION_GROUP_UNREADABLE", id, "no readable option"));
    return null;
  }
  return { externalId: id, externalCode: text(group.externalCode), name, ...bounds, available: availableOf(group.status), options };
}

/** The item's own warnings: a kind it maps only partly, and a missing price. */
function itemWarnings(raw: Json, priceCents: number | null): CatalogueReadWarning[] {
  const warnings: CatalogueReadWarning[] = [];
  const type = text(raw.type);
  if (type !== null && type !== "DEFAULT") warnings.push(warning("ITEM_TYPE_UNSUPPORTED", null, type));
  if (priceCents === null) warnings.push(warning("PRICE_MISSING", null, raw.price));
  return warnings;
}

/**
 * The group links of an item: on its product (CONFIRMED, the PUT example),
 * else on the item itself. Links that are not objects, or a value that is not
 * a list at all, are an OPTION_GROUP_UNREADABLE warning each.
 */
function linksOf(index: IfoodCatalogueIndex, raw: Json, warnings: CatalogueReadWarning[]): Json[] {
  const product = index.products.get(text(raw.productId) ?? "");
  const value = product?.optionGroups ?? raw.optionGroups;
  if (value !== undefined && value !== null && !Array.isArray(value)) warnings.push(warning("OPTION_GROUP_UNREADABLE", null, value));
  const { entries, others } = entriesOf(value);
  for (const other of others) warnings.push(warning("OPTION_GROUP_UNREADABLE", null, other));
  return entries;
}

/** One item of a category, or the notice that says why it could not be read. */
export function itemOf(raw: Json, index: IfoodCatalogueIndex, categoryId: string): CatalogueSnapshotItem | CatalogueReadNotice {
  const id = text(raw.id);
  // ESTIMATED: `item.productId` names the product that holds the item's name, description and photo.
  const described = describedBy(index, raw);
  if (id === null || described.name === null) {
    return { code: "ITEM_UNREADABLE", categoryExternalId: categoryId, externalId: id, detail: JSON.stringify(raw).slice(0, 300) };
  }
  const priceCents = priceCentsOf(raw.price);
  const warnings = itemWarnings(raw, priceCents);
  const photoUrl = photoInto(described.imagePath, null, warnings);
  const optionGroups = linksOf(index, raw, warnings).flatMap((link) => groupOf(link, index, warnings) ?? []);
  return {
    externalId: id,
    externalCode: described.externalCode,
    name: described.name,
    description: described.description,
    priceCents,
    photoUrl,
    available: availableOf(raw.status),
    optionGroups,
    warnings,
  };
}
