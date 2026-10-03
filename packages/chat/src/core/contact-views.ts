/**
 * The readings of a message the contact-info scanners look at: the text
 * normalised once, then widened with the host's vocabulary. Lives apart from
 * the scanners (`contact.ts`) so each file stays one idea.
 *
 * {@link fold} is the normalisation: NFKC (full-width and mathematical forms
 * become ASCII), format and private-use characters dropped (zero-width
 * joiners, soft hyphens, BOMs, bidi controls), lowercased, combining marks
 * dropped (accents, the keycap enclosure U+20E3, emoji variation selectors),
 * every decimal digit of any script mapped to ASCII, the common Cyrillic and
 * Greek look-alikes of Latin letters mapped to the Latin letter, and the full
 * stops of other scripts mapped to `.`.
 */

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
   * a call never depends on the previous one. Each runs against the raw text,
   * the normalised text, and a copy where runs of single letters are joined
   * (`w h a t s` → `whats`), so an accented pattern and a plain one both work.
   */
  readonly extraPatterns?: readonly RegExp[];
  /**
   * Spans that legitimately carry numbers — an address unit (`apt 1204`), a
   * lot, a room — blanked before the phone scan, so a street number and a unit
   * number do not add up to eight digits. Matched against the normalised text
   * (lowercase, no accents). A match counts as ONE digit, and only when it
   * holds at most five digits, is not followed straight away by a digit and
   * not preceded straight away by a run of five or more — so a host pattern
   * can never swallow a phone number's tail.
   */
  readonly neutralPatterns?: readonly RegExp[];
}

/** Private-use stand-ins for the host's at/dot words: user input is stripped of private-use characters first, so these cannot be typed. */
export const AT_MARK = "\uE001";
export const DOT_MARK = "\uE000";

const INVISIBLE = /[\p{Cf}\p{Co}]/gu;
const MARKS = /\p{M}+/gu;
const DECIMAL_DIGIT = /\p{Nd}/u;
const NON_ASCII_DIGIT = /[^\P{Nd}0-9]/gu;
const LETTER_RUN = /\p{L}+/gu;
/** Longer letter runs are left alone, so a pathological host vocabulary cannot make the token match slow. */
const MAX_NUMBER_TOKEN = 80;

/** Cyrillic then Greek look-alikes, and the Latin letter each passes for. */
const CONFUSABLE_FROM = [
  ..."\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0456\u0458\u0455\u0501\u0261\u043A\u043C\u043D\u0442\u0432",
  ..."\u03BF\u03B1\u03B5\u03B9\u03BA\u03BD\u03C1\u03C4\u03C5\u03C7",
];
const CONFUSABLE_TO = [..."aeopcyxijsdgkmhtb", ..."oaeikvptux"];
const CONFUSABLES = new Map(CONFUSABLE_FROM.map((from, index) => [from, CONFUSABLE_TO[index] ?? from]));
const CONFUSABLE = new RegExp(`[${CONFUSABLE_FROM.join("")}]`, "gu");
/** Full stops of other scripts and dot-like punctuation (ideographic, half-width, middle dot, bullets, Lisu, Armenian, Arabic), read as `.`. */
const DOT_LOOKALIKE = /[\u3002\uFF61\u00B7\u2027\u2219\u2022\uA4F8\u0589\u06D4]/g;

/** An override or isolate opening (LRO, RLO, LRI, RLI, FSI), and the run it governs up to PDF, PDI or the end of the line. */
const BIDI_OPENING = /[\u202D\u202E\u2066-\u2068]/;
const BIDI_RUN = /[\u202D\u202E\u2066-\u2068]([^\u202C\u2069\n]*)/g;

/** `(at)`, `[dot]`, `{@}`, `( <at-word> )` — a bracketed stand-in is deliberate, so it becomes the symbol itself. */
const BRACKETED = new RegExp(`(?<!\\s)\\s*[([{<]\\s*(at|dot|@|\\.|${AT_MARK}|${DOT_MARK})\\s*[)\\]}>]\\s*`, "g");

/**
 * Three or more single letters in a row, one to three separators apart, line
 * breaks included: `w h a t s`, `z-a-p`, `z` / `a` / `p` on three lines.
 * `e a casa` is two, so ordinary text is left alone.
 */
const SINGLE_LETTER_RUN = /(?<![\p{L}\p{N}])\p{L}(?![\p{L}\p{N}])(?:[^\p{L}\p{N}]{1,3}\p{L}(?![\p{L}\p{N}])){2,}/gu;
const NON_LETTER = /[^\p{L}]+/gu;

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
    .replace(NON_ASCII_DIGIT, asciiDigit)
    .replace(CONFUSABLE, (char) => CONFUSABLES.get(char) ?? char)
    .replace(DOT_LOOKALIKE, ".");
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

/** The host's pattern with its own flags, `i` added, and `g`/`y` replaced by `extra` (`""` to test, `"g"` to scan). */
function hostPattern(pattern: RegExp, extra: "" | "g"): RegExp {
  const flags = pattern.flags.replace(/[giy]/g, "");
  return new RegExp(pattern.source, `${flags}i${extra}`);
}

/** A vocabulary turned into regexes once, not once per message. */
export interface CompiledVocabulary {
  readonly numbers: NumberFolder | null;
  readonly atWords: RegExp | null;
  readonly dotWords: RegExp | null;
  readonly extra: readonly RegExp[];
  /** Global, for scanning with `matchAll`. */
  readonly neutral: readonly RegExp[];
}

const compiledCache = new WeakMap<ContactVocabulary, CompiledVocabulary>();

export function compile(vocabulary: ContactVocabulary): CompiledVocabulary {
  const cached = compiledCache.get(vocabulary);
  if (cached) return cached;
  const compiled: CompiledVocabulary = {
    numbers: numberFolder(vocabulary.numberWords),
    atWords: wordPattern(vocabulary.atWords),
    dotWords: wordPattern(vocabulary.dotWords),
    extra: (vocabulary.extraPatterns ?? []).map((pattern) => hostPattern(pattern, "")),
    neutral: (vocabulary.neutralPatterns ?? []).map((pattern) => hostPattern(pattern, "g")),
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

/** One reading of a message. */
export interface View {
  readonly raw: string;
  readonly folded: string;
  /** `folded` with number words as digits and the host's at/dot words as private marks. */
  readonly scan: string;
  /** `scan` with runs of single letters joined — read by the host's extra patterns only. */
  readonly collapsed: string;
}

export function view(raw: string, compiled: CompiledVocabulary): View {
  const folded = fold(raw);
  let scan = foldNumberWords(folded, compiled.numbers);
  scan = replaceWith(scan, compiled.atWords, AT_MARK);
  scan = replaceWith(scan, compiled.dotWords, DOT_MARK);
  scan = scan.replace(BRACKETED, unbracket);
  const collapsed = scan.replace(SINGLE_LETTER_RUN, (run) => run.replace(NON_LETTER, ""));
  return { raw, folded, scan, collapsed };
}

/**
 * The text roughly as DISPLAYED when it carries a bidi override or isolate:
 * each run after an opening control reversed, up to its closing control or
 * the end of the line. `null` when there is none. Reversing an LTR override
 * too is deliberate — an extra reading can only add a refusal, never hide one.
 */
function visualOrder(text: string): string | null {
  if (!BIDI_OPENING.test(text)) return null;
  return text.replace(BIDI_RUN, (_match, run: string) => [...run].reverse().join(""));
}

/** Every reading of a message: as stored, and as displayed when bidi controls reorder it. */
export function views(raw: string, compiled: CompiledVocabulary): readonly View[] {
  const visual = visualOrder(raw);
  return visual === null ? [view(raw, compiled)] : [view(raw, compiled), view(visual, compiled)];
}
