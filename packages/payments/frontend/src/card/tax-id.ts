import type { CardFieldCopy } from "./copy";
import { formatCpf, isValidCpf } from "./cpf";

/**
 * A payer's document: a CPF, or a CNPJ when the card is a company's.
 *
 * First for the card holder of the owner's activation charge (FUT-4048): an
 * owner paying with the company card (TMF SISTEMAS LTDA, say) has a CNPJ as
 * the holder's document. Then for the BUYER at checkout (FUT-4080): the field
 * at the top of Pagamento took 11 digits only, so a buyer paying with a
 * company card could not type the CNPJ ("Não aceita cnpj", reported from a
 * live storefront on 2026-10-27).
 *
 * One field, told apart by length and shape: up to 11 digits it is read and
 * masked as a CPF; past that, or from its first letter, as a CNPJ. The CNPJ
 * may be ALPHANUMERIC (FUT-590): from July 2026 the Receita issues CNPJs whose
 * first 12 characters may be `A-Z` (IN RFB nº 2.229/2024), masked
 * `AA.AAA.AAA/AAAA-DD`, kept uppercased, and checked by the same mod-11 with
 * each character worth its ASCII code minus 48. A CPF stays digits only.
 *
 * The rule MIRRORS `@12-apps/payments-backend`'s `core/tax-id.ts`, which the
 * buyer gate and a host's server read: this package may import only types from
 * there (ADOPTING.md §6). `components/checkout/__tests__/tax-id.contract.test.ts`
 * runs both over one table, so the field cannot take a document the gate
 * refuses, nor refuse one it takes.
 */

const CPF_LENGTH = 11;
const CNPJ_LENGTH = 14;

const CNPJ_SHAPE = /^[0-9A-Z]{12}[0-9]{2}$/;
const ONE_CHARACTER_REPEATED = /^(.)\1+$/;
const CHARACTER_ZERO = 48;

/**
 * The document's characters: digits and uppercased letters, punctuation and
 * spaces dropped — and NOTHING cut, so a value longer than a CNPJ's fourteen
 * is measured, and refused, as what it is. Mirrors the server's.
 */
export function taxIdCharacters(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * How a value is READ before any rule sees it (FUT-590 UI review): Unicode
 * NFKC, so fullwidth digits are ASCII and `º` is `O`; uppercased; and every
 * separator look-alike a paste carries — dashes and minus signs (U+2010–2015,
 * U+2212), the middle dot, the division and fullwidth slashes, a comma, an
 * underscore, a pipe — read as a `.`, one alphabet for what follows.
 */
const LOOK_ALIKE_SEPARATORS = /[‐-―−·∕／,_|]/g;

function normalise(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(LOOK_ALIKE_SEPARATORS, ".");
}

/** What a keystroke, or a paste of the field's own masked value, can hold. */
const TYPED_SHAPE = /^[0-9A-Z./-]*$/;

/** The words that name the document. Never a document's own characters when they stand alone. */
const LABEL_WORDS: ReadonlySet<string> = new Set(["CPF", "CNPJ"]);

/** A label word glued in front of the document's digits ("CPF529.982.247-25"). */
const GLUED_LABEL = /^(CPF|CNPJ)(?=\d)/;

/** A word glued after the document's digits ("…-25Fulano", "…-81LTDA"): three letters or more. */
const GLUED_WORD = /^(.*\d)([A-Z]{3,})$/;

/**
 * The TYPING path: a value with no space and nothing but the mask's own
 * characters, not led by a label word — what keystrokes and an unlabelled
 * masked paste produce, partial alphanumeric input ("12ABC") included. Its
 * characters are kept as typed, except a glued label dropped when that leaves
 * a valid document the label names. `undefined` sends the value to the scan.
 */
function typedDocument(value: string): string | undefined {
  if (!TYPED_SHAPE.test(value)) return undefined;
  const words = value.split(/[./-]+/).filter((word) => word !== "");
  if (words.length > 1 && LABEL_WORDS.has(words[0] ?? "")) return undefined;
  const kept = taxIdCharacters(value);
  if (kept.length > CNPJ_LENGTH && GLUED_WORD.test(kept)) return undefined;
  return withoutGluedLabel(kept);
}

/** `kept` without a glued CPF/CNPJ word, when it is no document and what is left is one the word names. */
function withoutGluedLabel(kept: string): string {
  const word = GLUED_LABEL.exec(kept)?.[1];
  if (word === undefined || isValidCpfOrCnpj(kept)) return kept;
  const rest = kept.slice(word.length);
  return isValidCnpj(rest) || (word === "CPF" && isValidCpf(rest)) ? rest : kept;
}

/**
 * One GROUP of the pasted text: a maximal run of `A-Z0-9`, a word glued after
 * digits split off as its own group. A label word is a group no window starts with.
 */
interface Group {
  text: string;
  numeric: boolean;
  lettersOnly: boolean;
  label: boolean;
}

function groupsOf(value: string): Group[] {
  return (value.match(/[0-9A-Z]+/g) ?? [])
    .flatMap((run) => {
      const glued = GLUED_WORD.exec(run);
      return glued ? [glued[1] ?? "", glued[2] ?? ""] : [run];
    })
    .map((text) => ({
      text,
      numeric: /^\d+$/.test(text),
      lettersOnly: /^[A-Z]+$/.test(text),
      label: LABEL_WORDS.has(text),
    }));
}

/** A run of consecutive groups, `start` to `end` exclusive, and its characters. */
interface Window {
  start: number;
  end: number;
  text: string;
  /** Starts with a letters-only group: a word in front ("MF", "Nº") may be the label, not the document. */
  weak: boolean;
}

/**
 * Every window of consecutive groups whose characters are exactly `length`
 * long, none led by a label word: "CPF 529.982.247-25" is never the CNPJ
 * "CPF52998224725". Inside a window a label word is just three letters — an
 * alphanumeric CNPJ may well hold them ("6C.CPF.T0W/SEXT-02").
 */
function windowsOf(groups: readonly Group[], length: number): Window[] {
  return groups.flatMap((group, start) => (group.label ? [] : windowFrom(groups, start, length)));
}

/** The window that starts at group `start` and is exactly `length` characters long, if the groups land there. */
function windowFrom(groups: readonly Group[], start: number, length: number): Window[] {
  let text = "";
  let end = start;
  while (end < groups.length && text.length < length) {
    text += groups[end]?.text ?? "";
    end += 1;
  }
  return text.length === length ? [{ start, end, text, weak: groups[start]?.lettersOnly ?? false }] : [];
}

/** The maximal runs of consecutive NUMERIC groups, as windows. */
function numericRuns(groups: readonly Group[]): Window[] {
  const runs: Window[] = [];
  let start = -1;
  for (let at = 0; at <= groups.length; at += 1) {
    const numeric = groups[at]?.numeric ?? false;
    if (numeric && start < 0) start = at;
    if (!numeric && start >= 0) {
      const text = groups.slice(start, at).map((group) => group.text).join("");
      runs.push({ start, end: at, text, weak: false });
      start = -1;
    }
  }
  return runs;
}

/** A weak window that cuts a number in two — a word, then the document's first digits — is the label's. */
function cutsANumber(groups: readonly Group[], window: Window): boolean {
  return window.weak && (groups[window.end]?.numeric ?? false);
}

function overlaps(a: Window, b: Window): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * The PASTE path: ONE group-aligned scan (FUT-590 UI review, round 8).
 *
 *  1. Valid documents. A CNPJ: a window of consecutive groups, exactly 14
 *     characters, that passes the check digits. A CPF: a maximal run of
 *     consecutive numeric groups totalling exactly 11 digits that passes the
 *     CPF check — the WHOLE run, so a 14-digit CNPJ typo split by spaces can
 *     never yield the CPF hiding in it — unless the label names only CNPJ. A
 *     CNPJ window led by a letters-only word ("CNPJ/MF 11.222…", "CNPJ Nº
 *     11.222…") is no document when it cuts a number in two, and yields to
 *     an overlapping valid document that is not word-led or starts after it:
 *     the word in front is the label. The first valid document, left to
 *     right, wins — a CPF named first beats a CNPJ named after it.
 *  2. Else the buyer must see their own typo: a window of 14 characters
 *     ending in two digits that carries a letter (an alphanumeric typo keeps
 *     its letters), else the digits of the longest numeric run, else — no
 *     digit at all — the characters as written.
 */
function scannedDocument(value: string): string {
  const groups = groupsOf(value);
  const cnpjOnly = groups.some((group) => group.text === "CNPJ") && !groups.some((group) => group.text === "CPF");
  const runs = numericRuns(groups);
  const cnpjs = windowsOf(groups, CNPJ_LENGTH).filter((window) => isValidCnpj(window.text));
  const cpfs = cnpjOnly ? [] : runs.filter((run) => run.text.length === CPF_LENGTH && isValidCpf(run.text));
  const candidates = [...cnpjs, ...cpfs];
  const yields = (window: Window): boolean =>
    window.weak &&
    (cutsANumber(groups, window) ||
      candidates.some((other) => other !== window && overlaps(window, other) && (!other.weak || other.start > window.start)));
  const valid = candidates.filter((window) => !yields(window)).sort((a, b) => a.start - b.start);
  const [document] = valid;
  if (document !== undefined) return document.text;

  const typos = windowsOf(groups, CNPJ_LENGTH).filter(
    (window) => CNPJ_SHAPE.test(window.text) && /[A-Z]/.test(window.text) && !cutsANumber(groups, window),
  );
  const typo = typos.find((window) => !window.weak) ?? typos[0];
  if (typo !== undefined) return typo.text;

  const longest = runs.reduce<Window | undefined>(
    (best, run) => (best === undefined || run.text.length > best.text.length ? run : best),
    undefined,
  );
  return longest?.text ?? taxIdCharacters(value);
}

/**
 * What the FIELD keeps as the buyer types or pastes: typing kept as typed, a
 * paste read by {@link scannedDocument} — once letters count, a label would
 * otherwise be read as the document's first characters (FUT-590 UI review) —
 * then capped at a CNPJ's fourteen, the most a document has. Only the input
 * path drops and caps; every check measures what it is given.
 */
export function taxIdInput(value: string): string {
  const normalised = normalise(value);
  return (typedDocument(normalised) ?? scannedDocument(normalised)).slice(0, CNPJ_LENGTH);
}

/** Whether the kept characters are a CPF on its way: digits only, at most eleven. */
function isCpfShaped(kept: string): boolean {
  return kept.length <= CPF_LENGTH && /^\d*$/.test(kept);
}

/** Progressive `AA.AAA.AAA/AAAA-DD` mask for a partially-typed CNPJ, numeric or alphanumeric. */
function formatCnpj(kept: string): string {
  let out = kept.slice(0, 2);
  if (kept.length >= 3) out += `.${kept.slice(2, 5)}`;
  if (kept.length >= 6) out += `.${kept.slice(5, 8)}`;
  if (kept.length >= 9) out += `/${kept.slice(8, 12)}`;
  if (kept.length >= 13) out += `-${kept.slice(12, 14)}`;
  return out;
}

/** One CNPJ check digit over `base`: weights 2..9 from the right, wrapping back to 2. */
function cnpjCheckDigit(base: string): number {
  let sum = 0;
  for (let i = 0; i < base.length; i += 1) {
    sum += (base.charCodeAt(base.length - 1 - i) - CHARACTER_ZERO) * ((i % 8) + 2);
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** A valid CNPJ, numeric or alphanumeric, by its two check digits; one character repeated is refused. */
function isValidCnpj(kept: string): boolean {
  if (!CNPJ_SHAPE.test(kept) || ONE_CHARACTER_REPEATED.test(kept)) return false;
  const first = cnpjCheckDigit(kept.slice(0, 12));
  const second = cnpjCheckDigit(kept.slice(0, 12) + String(first));
  return kept[12] === String(first) && kept[13] === String(second);
}

/**
 * The document as a charge carries it: its characters without punctuation
 * (FUT-4080, FUT-590), whatever shape the host's pre-fill or an older pack left
 * in the buyer state. `undefined` when there is none, so the body omits it.
 */
export function plainTaxId(value: string | undefined): string | undefined {
  const kept = taxIdCharacters(value ?? "");
  return kept === "" ? undefined : kept;
}

/** The CPF mask while it is one, the CNPJ mask past eleven digits or from its first letter. */
export function formatCpfOrCnpj(value: string): string {
  const kept = taxIdInput(value);
  return isCpfShaped(kept) ? formatCpf(kept) : formatCnpj(kept);
}

/** Whether `value` is a valid CPF (11 digits) or a valid CNPJ (14 characters), by their check digits. */
export function isValidCpfOrCnpj(value: string): boolean {
  const kept = taxIdCharacters(value);
  if (kept.length === CPF_LENGTH) return /^\d+$/.test(kept) && isValidCpf(kept);
  return isValidCnpj(kept);
}

/**
 * Whether a partly typed document is still SHORT of either length: under a
 * CPF's 11 digits, or between them and a CNPJ's 14 — and, once it carries a
 * letter, short of a CNPJ's 14. A value at 11 digits or 14 characters is
 * complete, valid or not.
 */
export function isIncompleteCpfOrCnpj(value: string): boolean {
  const kept = taxIdCharacters(value);
  if (!isCpfShaped(kept)) return kept.length < CNPJ_LENGTH;
  return kept.length < CPF_LENGTH;
}

/**
 * Which document a value holds, read by its length and shape — `null` while it
 * is neither. Eleven characters with a letter among them are a CNPJ on its way.
 */
export function taxIdKind(value: string | undefined): "CPF" | "CNPJ" | null {
  const kept = taxIdCharacters(value ?? "");
  if (kept.length === CPF_LENGTH && /^\d+$/.test(kept)) return "CPF";
  if (kept.length === CNPJ_LENGTH) return "CNPJ";
  return null;
}

/** Field validator for a CPF or a CNPJ: an error message, or `undefined` when valid. */
export function validateCpfOrCnpj(value: string, copy: CardFieldCopy): string | undefined {
  if (!taxIdCharacters(value)) return copy.taxIdRequired;
  return isValidCpfOrCnpj(value) ? undefined : copy.taxIdInvalid;
}
