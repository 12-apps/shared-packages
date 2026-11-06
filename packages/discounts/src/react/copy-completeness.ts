import type { DiscountsWebCopy } from "./copy";

/**
 * Whether a host's web copy pack is complete — split from `./copy` for the
 * file-size gate; `./copy` re-exports it.
 */

/**
 * Dotted paths `missingWebCopy` never reports (review round 6): optional in
 * the type, and filled in from the package's own packs by `completeWebCopy`.
 */
export const OPTIONAL_WEB_COPY_PATHS: ReadonlySet<string> = new Set([
  "window.daysUnknown",
  "window.daysUnknownList",
  "window.daysUnknownForm",
  "window.daysUnknownBoxes",
  "window.daysUnknownPaused",
  "window.datesLockedForm",
  "window.datesLockedBoxes",
  "window.datesLockedList",
  "window.openTimeZone",
  "form.calendar.locale",
  "form.calendar.label",
  "form.calendar.previousMonth",
  "form.calendar.nextMonth",
  "form.endsBeforeStartDay",
]);

/** Every leaf path of an object, dotted. */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return prefix === "" ? [] : [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

/** One dotted path out of a pack, or `undefined` where the path does not exist. */
function read(copy: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (node, key) =>
      node !== null && typeof node === "object"
        ? (node as Record<string, unknown>)[key]
        : undefined,
    copy,
  );
}

/**
 * The keys a pack is missing or left blank, as dotted paths.
 *
 * Walked from a REFERENCE pack rather than from a hand-kept key list: this
 * interface is seventy-odd keys deep in seven groups, and a list beside it
 * would be wrong within one release. Only the reference's SHAPE is read, never
 * its words — `createWebDiscounts` passes the pt-BR pack for that and nothing
 * of it survives into the answer.
 */
export function missingWebCopy(
  copy: DiscountsWebCopy | undefined,
  reference: DiscountsWebCopy,
): string[] {
  return leafPaths(reference).filter((path) => {
    if (OPTIONAL_WEB_COPY_PATHS.has(path)) return false;
    const value = read(copy, path);
    // A leaf is satisfied by a non-blank string OR a function. The `@12-apps/ui`
    // packs folded in below carry entries that take the interpolated value as
    // an argument — `noResults.title(query)`, `footer.selectedCount(count)` —
    // because Portuguese decides word order and plural agreement per sentence.
    // Demanding a string here would report every one of them as missing.
    if (typeof value === "function") return false;
    return typeof value !== "string" || value.trim() === "";
  });
}
