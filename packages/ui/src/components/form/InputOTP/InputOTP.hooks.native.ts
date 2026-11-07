import { useCallback, useEffect, useRef, useState } from 'react';

import { codeOfFill, firstSlotFill, isAllowed, padTo } from './InputOTP.core';

/** What a box needs from the element behind it: to take the focus. */
interface Focusable {
  focus: () => void;
}

interface NativeOtpInput {
  variant: string;
  length: number;
  value: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
}

/**
 * The native boxes' digits — the web hook's rules (`InputOTP.hooks.ts`) over
 * React Native's events: `onChangeText` carries the box's whole new text and
 * `onKeyPress` carries only the key's name, and there is no paste event at
 * all. A pasted or SMS-filled code arrives as a change of the FIRST box, whose
 * `maxLength` is the code's length plus one for exactly that reason, and is
 * spread across the boxes by the same `firstSlotFill` / `codeOfFill` the web
 * uses.
 */
export const useNativeOtpDigits = ({ variant, length, value, onChange, onComplete }: NativeOtpInput) => {
  const [digits, setDigits] = useState<string[]>(() => padTo([], length));
  const boxRefs = useRef<(Focusable | null)[]>([]);

  useEffect(() => {
    setDigits(padTo(value.split('').slice(0, length), length));
  }, [value, length]);

  const focusBox = useCallback((index: number) => boxRefs.current[index]?.focus(), []);

  const publish = useCallback(
    (next: string) => {
      onChange?.(next);
      if (next.length === length) onComplete?.(next);
    },
    [length, onChange, onComplete],
  );

  /** A whole code laid across the boxes from the first one. */
  const spread = useCallback(
    (text: string) => {
      const code = text.slice(0, length);
      if (!code || !isAllowed(variant, code)) return;
      setDigits(padTo(code.split(''), length));
      publish(code);
      focusBox(Math.min(code.length, length - 1));
    },
    [variant, length, publish, focusBox],
  );

  const handleChangeText = useCallback(
    (index: number, text: string) => {
      const fill = firstSlotFill(variant, index, text, digits[0] ?? '');
      if (fill) return fill === 'code' ? spread(codeOfFill(text, digits[0] ?? '', length)) : undefined;
      if (!isAllowed(variant, text)) return;
      const next = [...digits];
      next[index] = text.slice(-1);
      setDigits(next);
      publish(next.join(''));
      if (text && index < length - 1) focusBox(index + 1);
    },
    [variant, digits, length, publish, focusBox, spread],
  );

  /** Backspace in a box that is already empty steps back to the one before. */
  const handleKey = useCallback(
    (index: number, key: string) => {
      if (key === 'Backspace' && !digits[index] && index > 0) focusBox(index - 1);
    },
    [digits, focusBox],
  );

  return { digits, boxRefs, handleChangeText, handleKey };
};
