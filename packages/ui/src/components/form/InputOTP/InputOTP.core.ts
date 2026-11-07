/**
 * The digits' arithmetic, shared by both renderers' hooks (`InputOTP.hooks.ts`
 * on the web, `InputOTP.hooks.native.ts` on React Native). Pure: no React, no
 * DOM, no react-native.
 */

/**
 * What each variant accepts. `masked` constrains nothing — it only changes what
 * is drawn — so it has no pattern here.
 */
export const PATTERNS: Record<string, RegExp> = {
  numeric: /^\d*$/,
  alphanumeric: /^[a-zA-Z0-9]*$/,
};

/** Whether `text` is something this variant will take. */
export const isAllowed = (variant: string, text: string) => (PATTERNS[variant] ?? /.*/).test(text);

/** The digit array is always `length` long, blank-padded on the right. */
export const padTo = (digits: string[], length: number) =>
  Array.from({ length }, (_, i) => digits[i] ?? '');

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
export function firstSlotFill(variant: string, index: number, inputValue: string, current: string) {
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
