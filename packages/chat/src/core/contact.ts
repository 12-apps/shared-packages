/**
 * Contact information in a message: the filter that keeps a role from passing
 * a way to reach somebody outside the thread.
 *
 * Generic on purpose. Digits, `@`, a scheme and a domain look the same in
 * every language; the WORDS people use to dodge a filter do not ("nine", a
 * local word for "at", the name of a messaging app). Those arrive as host
 * vocabulary in {@link ContactVocabulary}, never baked in here.
 *
 * Errs toward refusing: a false refusal costs the sender a rephrase, a missed
 * phone number is the harm the filter exists to prevent.
 */

/** What the filter can look for. */
export type ContactKind = "phone" | "email" | "url" | "handle";

export const CONTACT_KINDS: readonly ContactKind[] = ["phone", "email", "url", "handle"];

/** Host vocabulary that widens the generic patterns. All optional. */
export interface ContactVocabulary {
  /** Spelled digits, word → digit (`{ nine: "9" }`), folded before the phone scan. */
  readonly numberWords?: Readonly<Record<string, string>>;
  /** Words standing in for `@` in an address (`["at"]`). */
  readonly atWords?: readonly string[];
  /** Words standing in for `.` in an address or a domain (`["dot"]`). */
  readonly dotWords?: readonly string[];
  /** Anything else that means "reach me elsewhere" — app names, slang. Matched case-insensitively. */
  readonly extraPatterns?: readonly RegExp[];
}

/** A run of 8+ digits, allowing the separators people type between them. */
const PHONE_RUN = /(?:\d[\s.\-()/+_*]*){8,}/;
const EMAIL = /[a-z0-9._%+-]+\s*@\s*[a-z0-9-]+(?:\s*\.\s*[a-z0-9-]+)+/i;
const URL_SCHEME = /\b(?:https?:\/\/|www\.)\S+/i;
const DOMAIN = /\b[a-z0-9-]{2,}\s*\.\s*(?:com|net|org|io|me|app|link|ly|gg|tv|co|info|biz|site|online|xyz|[a-z]{2})\b(?:\/\S*)?/i;
const HANDLE = /(?:^|[\s(])@[a-z0-9_.]{3,}/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lowercase, strip accents, so `NOVE`, `nóve` and `nove` read alike. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

function replaceWords(text: string, words: readonly string[], by: string): string {
  if (words.length === 0) return text;
  const pattern = new RegExp(`\\b(?:${words.map((word) => escapeRegExp(fold(word))).join("|")})\\b`, "g");
  return text.replace(pattern, by);
}

function foldNumberWords(text: string, numberWords: Readonly<Record<string, string>>): string {
  const entries = Object.entries(numberWords);
  if (entries.length === 0) return text;
  const map = new Map(entries.map(([word, digit]) => [fold(word), digit]));
  const pattern = new RegExp(`\\b(?:${[...map.keys()].map(escapeRegExp).join("|")})\\b`, "g");
  return text.replace(pattern, (word) => map.get(word) ?? word);
}

/** The text as the scanners read it: folded, with the host's words turned into symbols. */
function normalized(text: string, vocabulary: ContactVocabulary): string {
  let out = fold(text);
  out = foldNumberWords(out, vocabulary.numberWords ?? {});
  out = replaceWords(out, vocabulary.atWords ?? [], "@");
  out = replaceWords(out, vocabulary.dotWords ?? [], ".");
  return out;
}

/** One scanner per kind, over the normalized text. `extraPatterns` count as `handle` — they name a way to be reached. */
const SCANNERS: Readonly<Record<ContactKind, (scan: string, vocabulary: ContactVocabulary) => boolean>> = {
  phone: (scan) => PHONE_RUN.test(scan),
  email: (scan) => EMAIL.test(scan),
  url: (scan) => URL_SCHEME.test(scan) || DOMAIN.test(scan),
  handle: (scan, vocabulary) =>
    HANDLE.test(scan) || (vocabulary.extraPatterns ?? []).some((pattern) => new RegExp(pattern.source, "i").test(scan)),
};

/** Which of `kinds` the text contains, in {@link CONTACT_KINDS} order. Empty means the message may go. */
export function detectContactInfo(
  text: string,
  kinds: readonly ContactKind[],
  vocabulary: ContactVocabulary = {},
): ContactKind[] {
  if (kinds.length === 0) return [];
  const scan = normalized(text, vocabulary);
  return CONTACT_KINDS.filter((kind) => kinds.includes(kind) && SCANNERS[kind](scan, vocabulary));
}
