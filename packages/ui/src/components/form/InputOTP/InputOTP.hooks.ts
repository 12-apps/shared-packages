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

  const handleInputChange = useCallback(
    (index: number, inputValue: string) => {
      if (!isAllowed(variant, inputValue)) return;

      const next = [...digits];
      next[index] = inputValue.slice(-1); // one character per slot
      setDigits(next);
      publish(next.join(''));

      if (inputValue && index < length - 1) {
        focusSlot(index + 1);
      }
    },
    [variant, digits, length, publish, focusSlot],
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
      const pasted = e.clipboardData.getData('text').slice(0, length);

      // An empty paste is not a rejection, but it is nothing to apply either.
      if (!pasted || !isAllowed(variant, pasted)) return;

      setDigits(padTo(pasted.split(''), length));
      publish(pasted);
    },
    [variant, length, publish],
  );

  return { digits, inputRefs, handleInputChange, handleKeyDown, handlePaste };
};
