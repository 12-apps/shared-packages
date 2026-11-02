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
 * A label pasted in front of the document, as receipts, card statements and a
 * company's papers write it: "CPF 529.982.247-25", "CPF.: …", "CPF n.º …",
 * "CPF/CNPJ: …", "CNPJ/MF …", "CNPJ No 11.222…" (FUT-590 UI review). A RUN of
 * label words, joined by `/ . : -` or spaces, that starts with CPF or CNPJ.
 *
 * Which words are the label is NOT decided by the word list. `CNPJ: MF.ABC…`
 * is a label and an alphanumeric CNPJ that begins with MF, `CNPJ/MF: 11.222…`
 * is a two-word label: the same letters, two answers. So every place the run
 * could end is a candidate, and the document's own check digits choose
 * ({@link pastedDocument}).
 */
const RUN_START = /^(?:CPF|CNPJ)/i;
const LABEL_WORD = /^(?:CPF|CNPJ|MF|N\.?[º°]|NO\.|NO(?=\s)|N\.)/i;
const LABEL_JOIN = /^[\s/.:-]*/;

/** A leading label run: where it could end, and whether it names a CPF at all. */
interface LabelRun {
  ends: number[];
  namesCpf: boolean;
}

/**
 * The offsets at which a leading label run could end — after each label word
 * and the separators that follow it — and whether any of its words is CPF. A
 * word followed by nothing that separates it (`CPF12ABC…`) ends the scan:
 * those letters may be the document's own.
 */
function labelRun(value: string): LabelRun {
  const run: LabelRun = { ends: [], namesCpf: false };
  let at = value.length - value.trimStart().length;
  for (let pattern = RUN_START; ; pattern = LABEL_WORD) {
    const word = pattern.exec(value.slice(at));
    if (!word) return run;
    const join = LABEL_JOIN.exec(value.slice(at + word[0].length))?.[0] ?? "";
    if (join.length === 0 && !/[.º°]$/.test(word[0])) return run;
    at += word[0].length + join.length;
    if (at >= value.length) return run;
    if (/^CPF$/i.test(word[0])) run.namesCpf = true;
    run.ends.push(at);
  }
}

/**
 * The first DOCUMENT TOKEN at the head of `text`: letters and digits joined by
 * the mask's own `. / -`, with no space inside. Whatever follows a space or
 * any other mark (" - Empresa X LTDA", ", nascido em…") is never part of it,
 * and the token is never cut to a document's length — a 14-character typo
 * must stay a typo, not become the valid CPF its first eleven happen to be.
 */
const DOCUMENT_TOKEN = /^[0-9A-Za-z]+(?:[./-][0-9A-Za-z]+)*/;

function documentToken(text: string): string {
  return taxIdCharacters(DOCUMENT_TOKEN.exec(text)?.[0] ?? "");
}

/**
 * The characters of a value pasted with a label run, decided by one rule
 * (FUT-590 UI review, round 5). Each place the run could end gives the
 * document token after it; the field keeps, deepest cut first:
 *  a. a token that is a valid CNPJ — or a valid CPF, unless the run names
 *     only CNPJ ("CNPJ: 11.222.355/0001-42" is a CNPJ with a typo, never the
 *     CPF hiding in it);
 *  b. else a token of a document's length (11 or 14): a typo stays visible;
 *  c. else the deepest cut's token.
 * A value with no label run is kept as it is typed.
 */
function pastedDocument(value: string): string {
  const run = labelRun(value);
  if (run.ends.length === 0) return taxIdCharacters(value);
  const tokens = run.ends.map((end) => documentToken(value.slice(end))).reverse();
  const [deepest = ""] = tokens;
  const accepted = (token: string): boolean =>
    isValidCpfOrCnpj(token) && (token.length === CNPJ_LENGTH || run.namesCpf);
  return (
    tokens.find(accepted) ??
    tokens.find((token) => token.length === CPF_LENGTH || token.length === CNPJ_LENGTH) ??
    deepest
  );
}

/**
 * What the FIELD keeps as the buyer types or pastes: a pasted label dropped —
 * once letters count, it would otherwise be read as the document's first
 * characters (FUT-590 UI review) — then capped at a CNPJ's fourteen, the most
 * a document has. Only the input path drops and caps; every check measures
 * what it is given.
 */
export function taxIdInput(value: string): string {
  return pastedDocument(value).slice(0, CNPJ_LENGTH);
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
