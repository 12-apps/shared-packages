/**
 * Which of the package's two packs a host's sentences are filled in from
 * (FUT-4482, review round 7), shared by the web and the server packs.
 */

const said = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/**
 * A host's tag as a BCP-47 one: `pt_BR` is the POSIX spelling of `pt-BR`.
 * Anything `Intl` cannot read is no tag at all.
 */
export function languageTagOf(locale: string | null | undefined): string | undefined {
  if (!said(locale)) return undefined;
  try {
    return Intl.getCanonicalLocales(locale.trim().replace(/_/gu, "-"))[0];
  } catch {
    return undefined;
  }
}

/** Whether a tag is Portuguese, which the package's pt-BR pack answers. */
export function isPortuguese(tag: string): boolean {
  return /^pt(?:-|$)/iu.test(tag);
}

/** How many of a pack's sentences the host's pack says word for word. */
function sharedSentences(host: unknown, pack: unknown): number {
  if (typeof host === "string") return host === pack ? 1 : 0;
  if (host === null || typeof host !== "object" || pack === null || typeof pack !== "object") return 0;
  return Object.entries(host).reduce(
    (sum, [key, value]) => sum + sharedSentences(value, (pack as Record<string, unknown>)[key]),
    0,
  );
}

/**
 * With no tag anywhere, the host pack's own words decide: a host pack is, in
 * practice, one of the package's two with some sentences changed, so it is
 * taken for the one it shares more sentences with — en-US on a tie, which is
 * also the answer for a pack written wholly by hand. The limit: such a pack in
 * Portuguese, sharing no sentence with ours, is filled in English.
 */
export function nearestPack<T>(host: unknown, portuguese: T, english: T): T {
  return sharedSentences(host, portuguese) > sharedSentences(host, english) ? portuguese : english;
}
