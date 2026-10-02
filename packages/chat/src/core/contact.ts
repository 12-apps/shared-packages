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
 *
 * Every scanner reads a NORMALISED copy of the text (see {@link fold}): NFKC
 * (full-width and mathematical forms become ASCII), format and private-use
 * characters dropped (zero-width joiners, soft hyphens, BOMs), combining marks
 * dropped (accents, the keycap enclosure U+20E3, emoji variation selectors),
 * every decimal digit of any script mapped to ASCII, then lowercased.
 */

/** What the filter can look for. */
export type ContactKind = "phone" | "email" | "url" | "handle";

export const CONTACT_KINDS: readonly ContactKind[] = ["phone", "email", "url", "handle"];

/** Host vocabulary that widens the generic patterns. All optional. */
export interface ContactVocabulary {
  /**
   * Spelled digits, word → digit (`{ nine: "9" }`), folded before the scans.
   * A word is folded when it stands alone OR when a whole run of letters is
   * nothing but such words glued together (`nineeightseven`) — never inside
   * an ordinary word, so `ninety` stays a word.
   */
  readonly numberWords?: Readonly<Record<string, string>>;
  /** Words standing in for `@` in an address (`["at"]`). Count only toward an e-mail, never a handle. */
  readonly atWords?: readonly string[];
  /** Words standing in for `.` in an address or a domain (`["dot"]`). Count only before a known top-level domain. */
  readonly dotWords?: readonly string[];
  /**
   * Anything else that means "reach me elsewhere" — app names, slang. The
   * host's flags are kept (`u` included) and `i` added; `g`/`y` are dropped so
   * a call never depends on the previous one. Each runs against the raw text
   * AND the normalised text, so an accented pattern and a plain one both work.
   */
  readonly extraPatterns?: readonly RegExp[];
}

/*
 * PHONE: at least PHONE_MIN_DIGITS digits inside any PHONE_WINDOW characters,
 * whatever sits between them, measured after every run of non-alphanumeric
 * characters (spaces, punctuation, symbols, line breaks) has been collapsed to
 * one space. So `9,8,7`, `9 , 8 , 7` and `9a8b7` all cost one character per
 * gap, and `98765 e 4321` costs three.
 *
 * Eight digits because a landline without its area code is eight; a mobile
 * with or without its area code (9 or 11) contains eight. Sixteen characters
 * because that is the widest a digit-per-two-characters spelling of eight
 * digits gets (`9 8 7 6 5 4 3 2` is 15), with room for one short word
 * between two groups (`98765 e 4321`), while ordinary address and money lines
 * stay under it: `Rua 25 de ... 1520, apto 34` spans 24, `100,00, total
 * 37,90` spans 17. Known costs, accepted because a missed number is the harm:
 * a CEP (`01310-100`), a full date (`02/10/2026`) and a date with a time
 * (`02/10 14:30`) are eight digits and are refused. Known misses: digits
 * spread wider than that (`9 oi 8 oi 7 ...`) or split across messages beyond
 * the window {@link detectContactInfoAcross} is given.
 */
const PHONE_MIN_DIGITS = 8;
const PHONE_WINDOW = 16;

/*
 * Top-level domains. A curated list, because "any two letters" read `no.de`
 * and `ok.me` as domains. STRONG ones count on their own; PATH ones are also
 * ordinary words (`me`, `to`, `site`) and count only with a path after them
 * (`t.me/x`, `wa.me/55...`). Multi-part ones (`com.br`) need no entry: the
 * `com` already matches.
 */
const STRONG_TLDS = ["com", "net", "org", "br", "io", "info", "biz", "xyz", "ly", "gg", "app", "dev"];
const PATH_TLDS = ["me", "co", "tv", "us", "uk", "pt", "to", "cc", "ai", "link", "site", "online"];
const STRONG = STRONG_TLDS.join("|");
const ANY_TLD = [...STRONG_TLDS, ...PATH_TLDS].join("|");

/** Private-use stand-ins for the host's at/dot words: user input is stripped of private-use characters first, so these cannot be typed. */
const AT_MARK = "";
const DOT_MARK = "";

const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const AT = `(?:@|${AT_MARK})`;
const DOT = `(?:\\.|${DOT_MARK})`;
const LOCAL = "(?<![a-z0-9._%+-])[a-z0-9._%+-]+";

/** `ana@host.tld`, nothing between: any alphabetic top-level domain. */
const EMAIL_TIGHT = new RegExp(`${LOCAL}@${LABEL}(?:\\.${LABEL})*\\.[a-z]{2,}\\b`);
/** `ana @ host . com`, `ana <at-word> host <dot-word> com`: spacing allowed, so the domain must be a known one. */
const EMAIL_SPACED = new RegExp(`${LOCAL}\\s*${AT}\\s*${LABEL}(?:\\s*${DOT}\\s*${LABEL})*?\\s*${DOT}\\s*(?:${ANY_TLD})\\b`);
const URL_SCHEME = /\b(?:https?:\/\/|www\.)\S+/;
/** A literal dot with nothing around it — `Cheguei. Com` is a sentence, `site.com` is not. */
const DOMAIN = new RegExp(`(?<![a-z0-9-])(?:${LABEL}\\.)+(?:${STRONG})\\b`);
const DOMAIN_WITH_PATH = new RegExp(`(?<![a-z0-9-])(?:${LABEL}\\.)+(?:${ANY_TLD})\\/\\S`);
/** `site <dot-word> com`: a label of three or more, so `no ponto com` (at the spot, with) is not one. */
const DOMAIN_SPELLED = new RegExp(`(?<![a-z0-9-])[a-z0-9-]{3,}\\s*${DOT_MARK}\\s*(?:${STRONG})\\b`);
/** A literal `@` not glued to a preceding word (that is an e-mail), then a name starting with a letter. */
const HANDLE = /(?<![a-z0-9_.])@\s*[a-z_][a-z0-9_.]+/;
/** `(at)`, `[dot]`, `{@}`, `( <at-word> )` — a bracketed stand-in is deliberate, so it becomes the symbol itself. */
const BRACKETED = new RegExp(`\\s*[([{<]\\s*(at|dot|@|\\.|${AT_MARK}|${DOT_MARK})\\s*[)\\]}>]\\s*`, "g");

const INVISIBLE = /[\p{Cf}\p{Co}]/gu;
const MARKS = /\p{M}+/gu;
const DECIMAL_DIGIT = /\p{Nd}/u;
const NON_ASCII_DIGIT = /[^\P{Nd}0-9]/gu;
const NON_ALPHANUMERIC_RUN = /[^\p{L}\p{N}]+/gu;
const LETTER_RUN = /\p{L}+/gu;
const ASCII_DIGIT = /[0-9]/g;
/** Longer letter runs are left alone, so a pathological host vocabulary cannot make the token match slow. */
const MAX_NUMBER_TOKEN = 80;

/**
 * The value of a decimal digit in any script. Unicode lays every `Nd` script
 * out as a contiguous 0–9 run, so the value is the distance from the start of
 * the run (modulo ten, for scripts whose runs sit back to back).
 */
function asciiDigit(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  let zero = code;
  while (DECIMAL_DIGIT.test(String.fromCodePoint(zero - 1))) zero -= 1;
  return String((code - zero) % 10);
}

/** The text as every scanner reads it, before any host word is applied. */
function fold(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(MARKS, "")
    .replace(NON_ASCII_DIGIT, asciiDigit);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An alternation of the folded words, longest first so `uma` wins over `um`. */
function alternation(words: readonly string[]): string {
  return [...new Set(words.map(fold))]
    .filter((word) => word.length > 0)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
}

function wordPattern(words: readonly string[] | undefined): RegExp | null {
  const alternatives = alternation(words ?? []);
  return alternatives ? new RegExp(`\\b(?:${alternatives})\\b`, "g") : null;
}

interface NumberFolder {
  readonly whole: RegExp;
  readonly part: RegExp;
  readonly digits: ReadonlyMap<string, string>;
}

function numberFolder(numberWords: Readonly<Record<string, string>> | undefined): NumberFolder | null {
  const entries = Object.entries(numberWords ?? {});
  const alternatives = alternation(entries.map(([word]) => word));
  if (!alternatives) return null;
  return {
    whole: new RegExp(`^(?:${alternatives})+$`),
    part: new RegExp(alternatives, "g"),
    digits: new Map(entries.map(([word, digit]) => [fold(word), digit])),
  };
}

function hostPattern(pattern: RegExp): RegExp {
  const flags = pattern.flags.replace(/[gy]/g, "");
  return new RegExp(pattern.source, flags.includes("i") ? flags : `${flags}i`);
}

/** A vocabulary turned into regexes once, not once per message. */
interface CompiledVocabulary {
  readonly numbers: NumberFolder | null;
  readonly atWords: RegExp | null;
  readonly dotWords: RegExp | null;
  readonly extra: readonly RegExp[];
}

const compiledCache = new WeakMap<ContactVocabulary, CompiledVocabulary>();

function compile(vocabulary: ContactVocabulary): CompiledVocabulary {
  const cached = compiledCache.get(vocabulary);
  if (cached) return cached;
  const compiled: CompiledVocabulary = {
    numbers: numberFolder(vocabulary.numberWords),
    atWords: wordPattern(vocabulary.atWords),
    dotWords: wordPattern(vocabulary.dotWords),
    extra: (vocabulary.extraPatterns ?? []).map(hostPattern),
  };
  compiledCache.set(vocabulary, compiled);
  return compiled;
}

/** Turn a letter run into digits only when it is nothing BUT number words — `noveoito` yes, `novembro` no. */
function foldNumberWords(text: string, numbers: NumberFolder | null): string {
  if (!numbers) return text;
  return text.replace(LETTER_RUN, (token) =>
    token.length <= MAX_NUMBER_TOKEN && numbers.whole.test(token)
      ? token.replace(numbers.part, (word) => numbers.digits.get(word) ?? word)
      : token,
  );
}

function replaceWith(text: string, pattern: RegExp | null, by: string): string {
  return pattern ? text.replace(pattern, by) : text;
}

function unbracket(_match: string, symbol: string): string {
  return symbol === "at" || symbol === "@" || symbol === AT_MARK ? "@" : ".";
}

/** The three readings of one message the scanners look at. */
interface Views {
  readonly raw: string;
  readonly folded: string;
  /** `folded` with number words as digits and the host's at/dot words as private marks. */
  readonly scan: string;
}

function views(raw: string, compiled: CompiledVocabulary): Views {
  const folded = fold(raw);
  let scan = foldNumberWords(folded, compiled.numbers);
  scan = replaceWith(scan, compiled.atWords, AT_MARK);
  scan = replaceWith(scan, compiled.dotWords, DOT_MARK);
  return { raw, folded, scan: scan.replace(BRACKETED, unbracket) };
}

/** See PHONE_MIN_DIGITS / PHONE_WINDOW above. */
function hasPhone(scan: string): boolean {
  const compact = scan.replace(NON_ALPHANUMERIC_RUN, " ");
  const positions = Array.from(compact.matchAll(ASCII_DIGIT), (match) => match.index);
  for (let last = PHONE_MIN_DIGITS - 1; last < positions.length; last += 1) {
    const first = positions[last - PHONE_MIN_DIGITS + 1] ?? 0;
    if ((positions[last] ?? Infinity) - first < PHONE_WINDOW) return true;
  }
  return false;
}

function matchesHost(view: Views, extra: readonly RegExp[]): boolean {
  return extra.some((pattern) => pattern.test(view.raw) || pattern.test(view.folded) || pattern.test(view.scan));
}

type Scanner = (view: Views, compiled: CompiledVocabulary) => boolean;

/** One scanner per kind. `extraPatterns` count as `handle` — they name a way to be reached. */
const SCANNERS: Readonly<Record<ContactKind, Scanner>> = {
  phone: (view) => hasPhone(view.scan),
  email: (view) => EMAIL_TIGHT.test(view.scan) || EMAIL_SPACED.test(view.scan),
  url: (view) =>
    URL_SCHEME.test(view.scan) || DOMAIN.test(view.scan) || DOMAIN_WITH_PATH.test(view.scan) || DOMAIN_SPELLED.test(view.scan),
  handle: (view, compiled) => HANDLE.test(view.scan) || matchesHost(view, compiled.extra),
};

function detectCompiled(text: string, kinds: readonly ContactKind[], compiled: CompiledVocabulary): ContactKind[] {
  if (kinds.length === 0) return [];
  const view = views(text, compiled);
  return CONTACT_KINDS.filter((kind) => kinds.includes(kind) && SCANNERS[kind](view, compiled));
}

/** Which of `kinds` the text contains, in {@link CONTACT_KINDS} order. Empty means the message may go. */
export function detectContactInfo(
  text: string,
  kinds: readonly ContactKind[],
  vocabulary: ContactVocabulary = {},
): ContactKind[] {
  return detectCompiled(text, kinds, compile(vocabulary));
}

/**
 * {@link detectContactInfo} for a draft that may finish something the author
 * started in earlier messages (`98765`, then `4321`).
 *
 * `recent` is the SAME author's earlier bodies in the thread, oldest first —
 * a handful from the last few minutes, not the whole history: the longer the
 * list, the likelier two unrelated short numbers sit close enough to read as
 * one. The bodies and the draft are joined with line breaks, which the phone
 * window counts as one character, exactly like a space.
 *
 * Refuses a kind found in the draft alone, or in the join but NOT in the
 * recent bodies alone — a kind the earlier messages already carried (they
 * were sent, so they passed) never refuses an innocent draft; only a draft
 * that contributes to the match does.
 */
export function detectContactInfoAcross(
  recent: readonly string[],
  draft: string,
  kinds: readonly ContactKind[],
  vocabulary: ContactVocabulary = {},
): ContactKind[] {
  const compiled = compile(vocabulary);
  const alone = detectCompiled(draft, kinds, compiled);
  if (recent.length === 0) return alone;
  const before = recent.join("\n");
  const already = detectCompiled(before, kinds, compiled);
  const joined = detectCompiled(`${before}\n${draft}`, kinds, compiled);
  return CONTACT_KINDS.filter((kind) => alone.includes(kind) || (joined.includes(kind) && !already.includes(kind)));
}
