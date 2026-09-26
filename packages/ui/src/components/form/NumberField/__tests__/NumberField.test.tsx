/**
 * `NumberField` — digits only, `number | null`, arrow stepping inside bounds,
 * and a suffix inside the field (FUT-2823).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_DIGITS, clamp, digitsOf, isRefusedKey, parseDigits, stepValue } from '../NumberField.helpers';
import { NumberField } from '../NumberField';
import type { NumberFieldProps } from '../NumberField.types';

afterEach(cleanup);

describe('NumberField helpers', () => {
  it('keeps only digits, capped at a safe length', () => {
    expect(digitsOf('1.500 min')).toBe('1500');
    expect(digitsOf('-42')).toBe('42');
    expect(digitsOf('9'.repeat(20))).toHaveLength(MAX_DIGITS);
    expect(Number.isSafeInteger(Number(digitsOf('9'.repeat(20))))).toBe(true);
  });

  it('reads empty as null — never 0, never NaN', () => {
    expect(parseDigits('')).toBeNull();
    expect(parseDigits('abc')).toBeNull();
    expect(parseDigits('0')).toBe(0);
    expect(parseDigits('007')).toBe(7);
  });

  it('clamps to whichever bounds are set', () => {
    expect(clamp(5, { min: 10 })).toBe(10);
    expect(clamp(50, { max: 30 })).toBe(30);
    expect(clamp(20, { min: 10, max: 30 })).toBe(20);
    expect(clamp(20, {})).toBe(20);
  });

  it('steps within bounds, and lands on the floor from empty', () => {
    expect(stepValue(5, 1, 5, { max: 8 })).toBe(8);
    expect(stepValue(5, -1, 10, { min: 0 })).toBe(0);
    expect(stepValue(null, 1, 5, { min: 10 })).toBe(10);
    expect(stepValue(null, -1, 5, {})).toBe(0);
  });

  it('refuses a printable non-digit, and nothing else', () => {
    const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) =>
      isRefusedKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

    expect(key('a')).toBe(true);
    expect(key('-')).toBe(true);
    expect(key('.')).toBe(true);
    expect(key('7')).toBe(false);
    expect(key('Backspace')).toBe(false);
    expect(key('ArrowLeft')).toBe(false);
    expect(key('v', { ctrlKey: true })).toBe(false);
    expect(key('a', { metaKey: true })).toBe(false);
  });
});

/** A controlled host, recording every value the field reports. */
function Host(props: Partial<NumberFieldProps> & { initial?: number | null; seen?: (v: number | null) => void }) {
  const { initial = null, seen, ...rest } = props;
  const [value, setValue] = useState<number | null>(initial);
  return (
    <NumberField
      label="Timeout"
      data-testid="n"
      {...rest}
      value={value}
      onChange={(next) => {
        seen?.(next);
        setValue(next);
      }}
    />
  );
}

const field = () => screen.getByTestId('n') as HTMLInputElement;

describe('NumberField', () => {
  it('asks for the numeric keypad on the input itself, as a spinbutton', () => {
    render(<Host initial={15} min={1} max={120} />);

    expect(field().tagName).toBe('INPUT');
    expect(field()).toHaveAttribute('inputmode', 'numeric');
    expect(field()).toHaveAttribute('type', 'text');
    expect(field()).toHaveAttribute('role', 'spinbutton');
    expect(field()).toHaveAttribute('aria-valuenow', '15');
    expect(field()).toHaveAttribute('aria-valuemin', '1');
    expect(field()).toHaveAttribute('aria-valuemax', '120');
  });

  it('reports typed digits as a number', () => {
    const seen = vi.fn();
    render(<Host seen={seen} />);
    fireEvent.change(field(), { target: { value: '45' } });

    expect(seen).toHaveBeenLastCalledWith(45);
    expect(field()).toHaveValue('45');
  });

  it('keeps only the digits of a paste', () => {
    const seen = vi.fn();
    render(<Host seen={seen} />);
    fireEvent.change(field(), { target: { value: '1.500 min' } });

    expect(seen).toHaveBeenLastCalledWith(1500);
    expect(field()).toHaveValue('1500');
  });

  it('blocks a non-digit keystroke before it reaches the field', () => {
    render(<Host />);

    expect(fireEvent.keyDown(field(), { key: 'e' })).toBe(false);
    expect(fireEvent.keyDown(field(), { key: '5' })).toBe(true);
    expect(fireEvent.keyDown(field(), { key: 'Backspace' })).toBe(true);
  });

  it('reports a cleared field as null, not 0', () => {
    const seen = vi.fn();
    render(<Host initial={30} seen={seen} />);
    fireEvent.change(field(), { target: { value: '' } });

    expect(seen).toHaveBeenLastCalledWith(null);
    expect(field()).toHaveValue('');
    expect(field()).not.toHaveAttribute('aria-valuenow');
  });

  it('steps with ArrowUp / ArrowDown, by step, within min and max', () => {
    render(<Host initial={10} step={5} min={5} max={20} />);

    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(field()).toHaveValue('15');
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(field()).toHaveValue('20');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field()).toHaveValue('5');
  });

  it('starts an empty field at min on the first arrow press', () => {
    render(<Host min={10} />);
    fireEvent.keyDown(field(), { key: 'ArrowUp' });

    expect(field()).toHaveValue('10');
  });

  it('lets a value pass out of bounds while typing, and brings it back on blur', () => {
    const seen = vi.fn();
    render(<Host min={10} max={60} seen={seen} />);
    fireEvent.change(field(), { target: { value: '5' } });
    expect(field()).toHaveValue('5');

    fireEvent.blur(field());
    expect(seen).toHaveBeenLastCalledWith(10);

    fireEvent.change(field(), { target: { value: '99' } });
    fireEvent.blur(field());
    expect(seen).toHaveBeenLastCalledWith(60);
  });

  it('draws the suffix inside the field and reads it as the description', () => {
    render(<Host initial={15} suffix="min" helperText="Between 1 and 120" />);
    const suffix = screen.getByText('min');

    // Inside the input's own root — the element that draws the border.
    expect(suffix.closest('.MuiInputBase-root')).toBe(field().closest('.MuiInputBase-root'));
    expect(field().getAttribute('aria-describedby')?.split(' ')).toContain(suffix.id);
    expect(field().getAttribute('aria-describedby')).toMatch(/-helper-text/);
  });

  it("runs the caller's own onKeyDown, and respects its preventDefault", () => {
    const onKeyDown = vi.fn((event: React.KeyboardEvent) => event.preventDefault());
    render(<Host initial={1} onKeyDown={onKeyDown} />);
    fireEvent.keyDown(field(), { key: 'ArrowUp' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(field()).toHaveValue('1');
  });
});
