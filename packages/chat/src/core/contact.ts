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
 * The scanners read normalised copies of the text built in `contact-views.ts`.
 */
import { AT_MARK, compile, DOT_MARK, view, views, type CompiledVocabulary, type View } from "./contact-views";

export type { ContactVocabulary } from "./contact-views";
import type { ContactVocabulary } from "./contact-views";

/** What the filter can look for. */
export type ContactKind = "phone" | "email" | "url" | "handle";

export const CONTACT_KINDS: readonly ContactKind[] = ["phone", "email", "url", "handle"];

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
 * between two groups (`98765 e 4321`), while ordinary money lines stay over
 * it (`100,00, total 37,90` spans 17).
 *
 * Before the window, spans that legitimately carry numbers are blanked to one
 * letter (see NEUTRAL_RULES): clock times, amounts after a currency symbol,
 * and the host's `neutralPatterns` (address units). Each is blanked only when
 * it holds few digits and is not followed straight away by another digit.
 *
 * Known costs, accepted because a missed number is the harm: a CEP-shaped
 * postcode (`01310-100`), a full date (`02/10/2026`), and money without a
 * currency symbol (`total 100,00 + 37,90`) are eight digits and are refused.
 * Known misses: digits spread wider than the window (`9 oi 8 oi 7 ...`), and
 * a number whose first group is shaped like a time, an amount or a host unit
 * followed by a word (`apt 98765 and 4321`, `12:34 or 5678`) — that is
 * exactly the shape of `apt 1204 and 1205`, and the two cannot be told apart.
 */
const PHONE_MIN_DIGITS = 8;
const PHONE_WINDOW = 16;
/** Host spans: an address unit is at most five digits. */
const HOST_NEUTRAL_MAX_DIGITS = 5;

interface NeutralRule {
  readonly pattern: RegExp;
  readonly maxDigits: number;
}

/** Domain-free spans that carry digits and are not a phone. */
const NEUTRAL_RULES: readonly NeutralRule[] = [
  /** A valid clock time: `19:30`, `9h30`. */
  { pattern: /(?<!\d)(?:[01]?\d|2[0-3])[:h][0-5]\d(?!\d)/g, maxDigits: 4 },
  /** An amount after a currency symbol (`R$` ends in `$`): `$ 1.250,00` is six digits, so seven is the cap. */
  { pattern: /[$\u20AC\u00A3\u00A5]\s*\d[\d.]*(?:,\d{2})?/g, maxDigits: 7 },
];

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

const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const AT = `(?:@|${AT_MARK})`;
const DOT = `(?:\\.|${DOT_MARK})`;
/*
 * Every pattern below starts behind a lookbehind that admits only the FIRST
 * position of a run, so an unanchored search never restarts inside the run it
 * just failed on — a long `a.a.a.a…` or `aaaa…` stays linear, not quadratic.
 */
const LOCAL = "(?<![a-z0-9._%+-])[a-z0-9._%+-]+";
/** Not inside a label, and not right after `label.` (that start was already tried). */
const HOST_START = "(?<![a-z0-9-])(?<![a-z0-9-]\\.)";

/** `ana@host.tld`, nothing between: any alphabetic top-level domain. */
const EMAIL_TIGHT = new RegExp(`${LOCAL}@${LABEL}(?:\\.${LABEL})*\\.[a-z]{2,}\\b`);
/** `ana @ host . com`, `ana <at-word> host <dot-word> com`: spacing allowed, so the domain must be a known one. */
const EMAIL_SPACED = new RegExp(`${LOCAL}\\s*${AT}\\s*${LABEL}(?:\\s*${DOT}\\s*${LABEL})*?\\s*${DOT}\\s*(?:${ANY_TLD})\\b`);
const URL_SCHEME = /\b(?:https?:\/\/|www\.)\S+/;
/** A literal dot with nothing around it — `Cheguei. Com` is a sentence, `site.com` is not. */
const DOMAIN = new RegExp(`${HOST_START}(?:${LABEL}\\.)+(?:${STRONG})\\b`);
const DOMAIN_WITH_PATH = new RegExp(`${HOST_START}(?:${LABEL}\\.)+(?:${ANY_TLD})\\/\\S`);
/** `site <dot-word> com`: a label of three or more, so `no ponto com` (at the spot, with) is not one. */
const DOMAIN_SPELLED = new RegExp(`(?<![a-z0-9-])[a-z0-9-]{3,}\\s*${DOT_MARK}\\s*(?:${STRONG})\\b`);
/** A literal `@` not glued to a preceding word (that is an e-mail), then a name starting with a letter. */
const HANDLE = /(?<![a-z0-9_.])@\s*[a-z_][a-z0-9_.]+/;

const NON_ALPHANUMERIC_RUN = /[^\p{L}\p{N}]+/gu;
const ASCII_DIGIT = /[0-9]/g;
const FOLLOWED_BY_DIGIT = /[^\p{L}\p{N}]*[0-9]/uy;

function isNeutral(text: string, span: string, end: number, maxDigits: number): boolean {
  const digits = span.match(ASCII_DIGIT)?.length ?? 0;
  if (digits === 0 || digits > maxDigits) return false;
  FOLLOWED_BY_DIGIT.lastIndex = end;
  return !FOLLOWED_BY_DIGIT.test(text);
}

/** Blank every span of `rule` that may be blanked to one letter, `x`. */
function neutralise(text: string, rule: NeutralRule): string {
  let out = "";
  let from = 0;
  for (const match of text.matchAll(rule.pattern)) {
    const end = match.index + match[0].length;
    if (!isNeutral(text, match[0], end, rule.maxDigits)) continue;
    out += `${text.slice(from, match.index)} x `;
    from = end;
  }
  return out + text.slice(from);
}

/** See PHONE_MIN_DIGITS / PHONE_WINDOW above. */
function hasPhone(scan: string, compiled: CompiledVocabulary): boolean {
  const hostRules = compiled.neutral.map((pattern) => ({ pattern, maxDigits: HOST_NEUTRAL_MAX_DIGITS }));
  const blanked = [...NEUTRAL_RULES, ...hostRules].reduce(neutralise, scan);
  const compact = blanked.replace(NON_ALPHANUMERIC_RUN, " ");
  const positions = Array.from(compact.matchAll(ASCII_DIGIT), (match) => match.index);
  for (let last = PHONE_MIN_DIGITS - 1; last < positions.length; last += 1) {
    const first = positions[last - PHONE_MIN_DIGITS + 1] ?? 0;
    if ((positions[last] ?? Infinity) - first < PHONE_WINDOW) return true;
  }
  return false;
}

function matchesHost(reading: View, extra: readonly RegExp[]): boolean {
  const texts = [reading.raw, reading.folded, reading.scan, reading.collapsed];
  return extra.some((pattern) => texts.some((text) => pattern.test(text)));
}

type Scanner = (reading: View, compiled: CompiledVocabulary) => boolean;

/** One scanner per kind. `extraPatterns` count as `handle` — they name a way to be reached. */
const SCANNERS: Readonly<Record<ContactKind, Scanner>> = {
  phone: (reading, compiled) => hasPhone(reading.scan, compiled),
  email: (reading) => EMAIL_TIGHT.test(reading.scan) || EMAIL_SPACED.test(reading.scan),
  url: ({ scan }) => URL_SCHEME.test(scan) || DOMAIN.test(scan) || DOMAIN_WITH_PATH.test(scan) || DOMAIN_SPELLED.test(scan),
  handle: (reading, compiled) => HANDLE.test(reading.scan) || matchesHost(reading, compiled.extra),
};

function detectCompiled(text: string, kinds: readonly ContactKind[], compiled: CompiledVocabulary): ContactKind[] {
  if (kinds.length === 0) return [];
  const readings = views(text, compiled);
  return CONTACT_KINDS.filter((kind) => kinds.includes(kind) && readings.some((reading) => SCANNERS[kind](reading, compiled)));
}

/** Which of `kinds` the text contains, in {@link CONTACT_KINDS} order. Empty means the message may go. */
export function detectContactInfo(
  text: string,
  kinds: readonly ContactKind[],
  vocabulary: ContactVocabulary = {},
): ContactKind[] {
  return detectCompiled(text, kinds, compile(vocabulary));
}

/** A character a split number can be cut at: a digit or `.`. Counts only when BOTH sides of the cut have one. */
const CONTACT_EDGE = /^[0-9.]$/;
/** `@` or a host at/dot word: an address cut there needs only ONE side (`ana` | `@` | `gmail.com`). */
const ADDRESS_EDGE = new RegExp(`^[@${AT_MARK}${DOT_MARK}]$`);
const EDGE_SKIP = new RegExp(`[^\\p{L}\\p{N}@.${AT_MARK}${DOT_MARK}]`, "u");

/** The first (or last) character of a reading that is not a space or ordinary punctuation. */
function edge(scan: string, side: "start" | "end"): string {
  const chars = [...scan];
  if (side === "end") chars.reverse();
  return chars.find((char) => !EDGE_SKIP.test(char)) ?? "";
}

/**
 * Whether two consecutive messages may be one contact cut in two: digit (or
 * dot) on both sides of the cut, or an address symbol on either side, or a
 * later message opening with `.` (`.com`). A sentence ending in `.` is not
 * enough on its own — it is how most sentences end.
 */
function touches(earlier: string, later: string): boolean {
  const end = edge(earlier, "end");
  const start = edge(later, "start");
  if (ADDRESS_EDGE.test(end) || ADDRESS_EDGE.test(start) || start === ".") return true;
  return CONTACT_EDGE.test(end) && CONTACT_EDGE.test(start);
}

/** The recent messages that run contiguously into the draft, oldest first; stops at the first clean cut. */
function chainBefore(recent: readonly string[], draft: string, compiled: CompiledVocabulary): string[] {
  const chain: string[] = [];
  let later = view(draft, compiled).scan;
  for (const body of [...recent].reverse()) {
    const earlier = view(body, compiled).scan;
    if (!touches(earlier, later)) break;
    chain.unshift(body);
    later = earlier;
  }
  return chain;
}

/**
 * {@link detectContactInfo} for a draft that may finish something the author
 * started in earlier messages (`98765`, then `4321`; `9`, `8`, `7`… one digit
 * a message).
 *
 * `recent` is the SAME author's earlier bodies in the thread, oldest first.
 * Only the CHAIN that runs into the draft is read: walking back from the
 * draft, an earlier message joins when its end AND the next message's start
 * are a digit or `.` (trailing and leading punctuation skipped), or when
 * either is `@` or a host at/dot word, or the later one opens with `.`; the
 * walk stops at the first cut that is none of those. `Cheguei` then `1204` is
 * a clean cut; `98765,` then `4321` is not. The chain and the draft are
 * joined with line breaks, which the phone window counts as one character.
 *
 * Known misses, the price of reading only a contiguous chain: a group opened
 * by a word (`98765` then `e 4321`), and a digit trickle with chatter in the
 * middle (`987654`, `Oi`, `3`, `2`).
 *
 * Refuses a kind found in the draft alone, or in chain + draft but NOT in the
 * chain alone — a kind the earlier messages already carried (they were sent,
 * so they passed) never refuses an innocent draft; only a draft that
 * contributes to the match does.
 */
export function detectContactInfoAcross(
  recent: readonly string[],
  draft: string,
  kinds: readonly ContactKind[],
  vocabulary: ContactVocabulary = {},
): ContactKind[] {
  const compiled = compile(vocabulary);
  const alone = detectCompiled(draft, kinds, compiled);
  const chain = kinds.length === 0 ? [] : chainBefore(recent, draft, compiled);
  if (chain.length === 0) return alone;
  const before = chain.join("\n");
  const already = detectCompiled(before, kinds, compiled);
  const joined = detectCompiled(`${before}\n${draft}`, kinds, compiled);
  return CONTACT_KINDS.filter((kind) => alone.includes(kind) || (joined.includes(kind) && !already.includes(kind)));
}
