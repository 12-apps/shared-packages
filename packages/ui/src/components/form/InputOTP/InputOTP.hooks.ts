import { useCallback, useEffect, useRef, useState } from 'react';

import { digitsOf, isComplete, keyMove, padTo, slotChange, spreadChange } from './InputOTP.core';
import type { OtpChange } from './InputOTP.core';

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
 * The rules themselves — what a slot accepts, how a whole code spreads, where
 * a key moves — are `InputOTP.core.ts`, shared with the native renderer. Focus
 * moves as a consequence of entry, so the input refs live here with the state
 * that drives them.
 */
export const useOtpDigits = ({ variant, length, value, onChange, onComplete }: OtpInput) => {
  const [digits, setDigits] = useState<string[]>(() => padTo([], length));
  const inputRefs = useRef<(globalThis.HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setDigits(digitsOf(value, length));
  }, [value, length]);

  const focusSlot = useCallback((index: number) => {
    inputRefs.current[index]?.focus();
  }, []);

  /** Applies a change: the digits, the joined value (and completion), then focus. */
  const apply = useCallback(
    (change: OtpChange) => {
      if (change.kind === 'none') return;
      setDigits(change.digits);
      onChange?.(change.value);
      if (isComplete(change.value, length)) {
        onComplete?.(change.value);
      }
      if (change.focus !== null) focusSlot(change.focus);
    },
    [length, onChange, onComplete, focusSlot],
  );

  const handleInputChange = useCallback(
    (index: number, inputValue: string) => {
      apply(slotChange({ variant, length, digits, index, inputValue }));
    },
    [variant, digits, length, apply],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      const target = keyMove(e.key, index, length, digits);
      if (target !== null) focusSlot(target);
    },
    [digits, length, focusSlot],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      apply(spreadChange(variant, length, e.clipboardData.getData('text')));
    },
    [variant, length, apply],
  );

  return { digits, inputRefs, handleInputChange, handleKeyDown, handlePaste };
};
