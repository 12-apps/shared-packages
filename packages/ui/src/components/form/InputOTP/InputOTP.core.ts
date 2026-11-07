/**
 * THE DIGIT RULES BOTH `InputOTP` RENDERERS FOLLOW.
 *
 * No React, no MUI, no react-native: what a slot accepts, how a whole code
 * written into the first slot spreads across the rest, and which slot a key
 * moves to. `InputOTP.hooks.ts` (web) and `InputOTP.native.tsx` read these, so
 * the two cannot disagree about what a keystroke or an SMS fill does.
 */
import type { InputOTPVariant } from './InputOTP.base';

/**
 * What each variant accepts. `masked` constrains nothing — it only changes what
 * is drawn — so it has no pattern here.
 */
const PATTERNS: Record<string, RegExp> = {
  numeric: /^\d*$/,
  alphanumeric: /^[a-zA-Z0-9]*$/,
};

/** Whether `text` is something this variant will take. */
export const isAllowed = (variant: string, text: string): boolean => (PATTERNS[variant] ?? /.*/).test(text);

/** The digit array is always `length` long, blank-padded on the right. */
export const padTo = (digits: readonly string[], length: number): string[] =>
  Array.from({ length }, (_, i) => digits[i] ?? '');

/** The slots a controlled `value` draws: its first `length` characters. */
export const digitsOf = (value: string, length: number): string[] => padTo(value.split('').slice(0, length), length);

/**
 * What a change to the numeric FIRST slot is, now that its `maxLength` is the
 * code's length rather than 1 (FUT-4144).
 *
 * That slot carries `one-time-code`, and the phone's SMS fill (or a password
 * manager) writes the WHOLE code into it as one change, not a paste — kept to
 * one character, the code lost every digit but the last. So:
 *
 * - `overtype`: a keystroke into the already-filled slot (its old character
 *   plus the new one). Ignored, exactly as `maxLength={1}` refused it before.
 * - `code`: anything else longer than one character, written in one go.
 *   Spread across the slots like a paste.
 *
 * Every other slot and variant keeps `maxLength={1}` and never gets here.
 */
export function firstSlotFill(
  variant: string,
  index: number,
  inputValue: string,
  current: string,
): 'overtype' | 'code' | null {
  if (variant !== 'numeric' || index !== 0 || inputValue.length < 2) return null;
  const overtype = inputValue.length === 2 && current !== '' && inputValue.includes(current);
  return overtype ? 'overtype' : 'code';
}

/**
 * The code inside a first-slot fill. A phone that INSERTS the SMS code at the
 * caret rather than replacing the slot leaves the digit already there in
 * front: `4` + `482913` arrives as `4482913`, which spread as-is would give
 * `448291`. Longer than the code and led by that digit: the digit is dropped.
 */
export const codeOfFill = (inputValue: string, current: string, length: number): string =>
  inputValue.length > length && current !== '' && inputValue.startsWith(current) ? inputValue.slice(1) : inputValue;

/**
 * One character per slot — except the numeric FIRST slot, which carries
 * `one-time-code`: the phone's SMS fill writes the whole code there in one
 * change, and a `maxLength` of 1 would cut it to one digit before the rules
 * could spread it.
 *
 * The code's length PLUS ONE: a phone that INSERTS the code at the caret keeps
 * the digit already there in front (`4` + `482913`), and the field caps that
 * insertion at `maxLength` BEFORE the rules see it. At the bare length it
 * arrived as `448291` — a wrong code that looks whole. One more character lets
 * {@link codeOfFill} see the leading digit and drop it. A keystroke into the
 * slot once filled is still refused, by {@link firstSlotFill}.
 */
export const slotMaxLength = (variant: InputOTPVariant | undefined, index: number, length: number): number =>
  variant === 'numeric' && index === 0 ? length + 1 : 1;

/** What a change does to the slots: nothing, or new digits, a value to publish and maybe a slot to focus. */
export type OtpChange =
  | { kind: 'none' }
  | { kind: 'apply'; digits: string[]; value: string; focus: number | null };

const NONE: OtpChange = { kind: 'none' };

/** Lays a whole code across the slots from the first: a paste, or an OS/SMS fill. */
export function spreadChange(variant: string, length: number, text: string): OtpChange {
  const code = text.slice(0, length);
  // An empty code is not a rejection, but it is nothing to apply either.
  if (!code || !isAllowed(variant, code)) return NONE;
  return { kind: 'apply', digits: padTo(code.split(''), length), value: code, focus: null };
}

export interface SlotInput {
  variant: string;
  length: number;
  digits: readonly string[];
  index: number;
  inputValue: string;
}

/** What the text a slot now holds does to the code. */
export function slotChange({ variant, length, digits, index, inputValue }: SlotInput): OtpChange {
  const current = digits[0] ?? '';
  const fill = firstSlotFill(variant, index, inputValue, current);
  if (fill === 'overtype') return NONE;
  if (fill === 'code') return spreadChange(variant, length, codeOfFill(inputValue, current, length));
  if (!isAllowed(variant, inputValue)) return NONE;

  const next = [...digits];
  next[index] = inputValue.slice(-1); // one character per slot
  return {
    kind: 'apply',
    digits: next,
    value: next.join(''),
    focus: inputValue && index < length - 1 ? index + 1 : null,
  };
}

/**
 * The slot a key moves focus to, or `null`. Backspace in an already-empty slot
 * steps back rather than deleting; the arrows walk the row.
 */
export function keyMove(key: string, index: number, length: number, digits: readonly string[]): number | null {
  const back = (key === 'Backspace' && !digits[index]) || key === 'ArrowLeft';
  if (back) return index > 0 ? index - 1 : null;
  if (key === 'ArrowRight' && index < length - 1) return index + 1;
  return null;
}

/** Whether a published value is a whole code — the moment `onComplete` fires. */
export const isComplete = (value: string, length: number): boolean => value.length === length;
