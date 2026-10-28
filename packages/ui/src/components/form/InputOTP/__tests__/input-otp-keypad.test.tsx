/**
 * A NUMERIC CODE TELLS THE PHONE IT IS DIGITS (FUT-4144).
 *
 * The courier's six-digit join code (`variant="numeric"`, `length={6}`) opened
 * the letter keyboard: each slot got `maxLength`, a style and a test id, and
 * nothing that names a keypad. The hook refusing letters is invisible to the
 * phone. These read the six `<input>` elements themselves.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InputOTP } from '../InputOTP';
import type { InputOTPProps } from '../InputOTP.types';

function slotsOf(props: Partial<InputOTPProps> & { 'aria-label'?: string } = {}) {
  render(<InputOTP length={6} dataTestId="code" {...props} />);
  return Array.from({ length: props.length ?? 6 }, (_, index) => screen.getByTestId(`code-slot-${index}`));
}

describe('InputOTP: numeric keypad on every slot', () => {
  it('puts inputmode=numeric and pattern=[0-9]* on each of the six <input>s', () => {
    const slots = slotsOf({ variant: 'numeric' });

    expect(slots).toHaveLength(6);
    for (const slot of slots) {
      expect(slot.tagName).toBe('INPUT');
      expect(slot).toHaveAttribute('inputmode', 'numeric');
      expect(slot).toHaveAttribute('pattern', '[0-9]*');
    }
  });

  it('offers the SMS code on the first slot only', () => {
    const [first, ...others] = slotsOf({ variant: 'numeric' });

    expect(first).toHaveAttribute('autocomplete', 'one-time-code');
    for (const slot of others) expect(slot).not.toHaveAttribute('autocomplete');
  });

  it('is the default variant, so a caller who names none gets the keypad too', () => {
    const [first] = slotsOf();

    expect(first).toHaveAttribute('inputmode', 'numeric');
    expect(first).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('leaves no keypad hint on the wrapper', () => {
    slotsOf({ variant: 'numeric' });
    const group = screen.getByTestId('code');

    expect(group).not.toHaveAttribute('inputmode');
    expect(group).not.toHaveAttribute('pattern');
  });
});

describe('InputOTP: the other variants are unchanged', () => {
  it.each(['alphanumeric', 'masked'] as const)('%s slots carry no inputmode, pattern or autocomplete', (variant) => {
    for (const slot of slotsOf({ variant })) {
      expect(slot).not.toHaveAttribute('inputmode');
      expect(slot).not.toHaveAttribute('pattern');
      expect(slot).not.toHaveAttribute('autocomplete');
      expect(slot).toHaveAttribute('maxlength', '1');
    }
  });
});

describe('InputOTP: the code is named as a group', () => {
  it('names the six slots together through role=group and the caller aria-label', () => {
    slotsOf({ variant: 'numeric', 'aria-label': 'Código de entrada' });
    const group = screen.getByRole('group', { name: 'Código de entrada' });

    expect(within(group).getAllByRole('textbox')).toHaveLength(6);
  });
});

describe('InputOTP: a whole code filled into the first slot (SMS, password manager)', () => {
  it('lets the numeric first slot take the whole code, and keeps the others at one', () => {
    const [first, ...others] = slotsOf({ variant: 'numeric' });

    expect(first).toHaveAttribute('maxlength', '6');
    for (const slot of others) expect(slot).toHaveAttribute('maxlength', '1');
  });

  it('spreads a code written into the first slot in one change across every slot', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    const slots = slotsOf({ variant: 'numeric', onChange, onComplete });

    fireEvent.change(slots[0] as HTMLElement, { target: { value: '482913' } });

    expect(slots.map((slot) => (slot as HTMLInputElement).value)).toEqual(['4', '8', '2', '9', '1', '3']);
    expect(onChange).toHaveBeenLastCalledWith('482913');
    expect(onComplete).toHaveBeenCalledWith('482913');
  });

  it('cuts a longer fill at the code length', () => {
    const onChange = vi.fn();
    const slots = slotsOf({ variant: 'numeric', onChange });

    fireEvent.change(slots[0] as HTMLElement, { target: { value: '12345678' } });

    expect(onChange).toHaveBeenLastCalledWith('123456');
  });

  it('refuses a fill with letters, as a paste would', () => {
    const onChange = vi.fn();
    const slots = slotsOf({ variant: 'numeric', onChange });

    fireEvent.change(slots[0] as HTMLElement, { target: { value: '48a913' } });

    expect(onChange).not.toHaveBeenCalled();
    expect(slots[0]).toHaveValue('');
  });

  it('still refuses a second keystroke into the filled first slot, as maxLength 1 did', () => {
    const onChange = vi.fn();
    const slots = slotsOf({ variant: 'numeric', onChange });

    fireEvent.change(slots[0] as HTMLElement, { target: { value: '4' } });
    expect(slots[0]).toHaveValue('4');
    // A second key in the filled slot: the old digit plus the new one.
    fireEvent.change(slots[0] as HTMLElement, { target: { value: '47' } });

    expect(slots[0]).toHaveValue('4');
    expect(slots[1]).toHaveValue('');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('spreads a two-digit fill that is not a keystroke onto the old digit', () => {
    const onChange = vi.fn();
    const slots = slotsOf({ variant: 'numeric', length: 4, onChange });

    fireEvent.change(slots[0] as HTMLElement, { target: { value: '4' } });
    fireEvent.change(slots[0] as HTMLElement, { target: { value: '8291' } });

    expect(slots.map((slot) => (slot as HTMLInputElement).value)).toEqual(['8', '2', '9', '1']);
  });

  it('does not spread on the alphanumeric variant, whose slots stay one character', () => {
    const onChange = vi.fn();
    const slots = slotsOf({ variant: 'alphanumeric', onChange });

    expect(slots[0]).toHaveAttribute('maxlength', '1');
    fireEvent.change(slots[0] as HTMLElement, { target: { value: 'AB12' } });
    expect(slots[1]).toHaveValue('');
  });
});
