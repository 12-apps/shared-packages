import { useCallback, useEffect, useRef, useState } from 'react';


/**
 * What each variant accepts. `masked` constrains nothing — it only changes what
 * is drawn — so it has no pattern here.
 */
const PATTERNS: Record<string, RegExp> = {
  numeric: /^\d*$/,
  alphanumeric: /^[a-zA-Z0-9]*$/,
};

/** Whether `text` is something this variant will take. */
const isAllowed = (variant: string, text: string) => (PATTERNS[variant] ?? /.*/).test(text);

/** The digit array is always `length` long, blank-padded on the right. */
const padTo = (digits: string[], length: number) =>
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
function firstSlotFill(variant: string, index: number, inputValue: string, current: string) {
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
const codeOfFill = (inputValue: string, current: string, length: number): string =>
  inputValue.length > length && current !== '' && inputValue.startsWith(current) ? inputValue.slice(1) : inputValue;

interface OtpInput {
  variant: string;
  length: number;
  value: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
}

/**
 * The digits, and the three ways they change: typing, the keys that move
 * between slots, and a paste into the first one.
 *
 * Focus moves as a consequence of entry, so the input refs live here with the
 * state that drives them.
 */
export const useOtpDigits = ({ variant, length, value, onChange, onComplete }: OtpInput) => {
  const [digits, setDigits] = useState<string[]>(() => padTo([], length));
  const inputRefs = useRef<(globalThis.HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setDigits(padTo(value.split('').slice(0, length), length));
  }, [value, length]);

  const focusSlot = useCallback((index: number) => {
    inputRefs.current[index]?.focus();
  }, []);

  /** Publishes the joined value, and reports completion when every slot is full. */
  const publish = useCallback(
    (next: string) => {
      onChange?.(next);
      if (next.length === length) {
        onComplete?.(next);
      }
    },
    [length, onChange, onComplete],
  );

  /** Lays a whole code across the slots from the first: a paste, or an OS/SMS fill. */
  const spread = useCallback(
    (text: string) => {
      const code = text.slice(0, length);
      // An empty code is not a rejection, but it is nothing to apply either.
      if (!code || !isAllowed(variant, code)) return;

      setDigits(padTo(code.split(''), length));
      publish(code);
    },
    [variant, length, publish],
  );

  const handleInputChange = useCallback(
    (index: number, inputValue: string) => {
      const fill = firstSlotFill(variant, index, inputValue, digits[0] ?? '');
      if (fill) return fill === 'code' ? spread(codeOfFill(inputValue, digits[0] ?? '', length)) : undefined;
      if (!isAllowed(variant, inputValue)) return;

      const next = [...digits];
      next[index] = inputValue.slice(-1); // one character per slot
      setDigits(next);
      publish(next.join(''));

      if (inputValue && index < length - 1) {
        focusSlot(index + 1);
      }
    },
    [variant, digits, length, publish, focusSlot, spread],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      // Backspace in an already-empty slot steps back rather than deleting.
      const back =
        (e.key === 'Backspace' && !digits[index]) || e.key === 'ArrowLeft';

      if (back && index > 0) {
        focusSlot(index - 1);
      } else if (e.key === 'ArrowRight' && index < length - 1) {
        focusSlot(index + 1);
      }
    },
    [digits, length, focusSlot],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      spread(e.clipboardData.getData('text'));
    },
    [spread],
  );

  return { digits, inputRefs, handleInputChange, handleKeyDown, handlePaste };
};
