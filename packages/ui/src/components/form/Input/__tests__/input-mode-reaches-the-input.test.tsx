/**
 * A TOP-LEVEL `inputMode` and `autoComplete` reach the `<input>` (FUT-1440).
 *
 * `Input` puts every attribute it does not recognise on the text field's root
 * `<div>`, and `inputMode` was one of them: `<Input inputMode="numeric" />`
 * type-checked and raised the letters keyboard on a phone, because a div has
 * no keyboard to choose. Every caller that wrote it at the top level — the
 * natural spelling, since `InputProps` declares it — shipped the wrong keypad.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../Input';
import { Input as OutlinedInput } from '../outlined';

const rootOf = (input: HTMLElement) => input.closest('.MuiFormControl-root') as HTMLElement;

describe.each([
  ['Input', Input],
  ['outlined Input', OutlinedInput],
])('%s: top-level inputMode and autoComplete land on the <input>', (_name, Field) => {
  it('puts a top-level inputMode on the input, not the root', () => {
    render(<Field data-testid="campo" inputMode="numeric" />);
    const input = screen.getByTestId('campo');

    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(rootOf(input)).not.toHaveAttribute('inputmode');
  });

  it('follows a changed inputMode', () => {
    const { rerender } = render(<Field data-testid="campo" inputMode="numeric" />);
    rerender(<Field data-testid="campo" inputMode="text" />);

    expect(screen.getByTestId('campo')).toHaveAttribute('inputmode', 'text');
  });

  it('lets an inputProps inputMode win over the top-level one', () => {
    render(<Field data-testid="campo" inputMode="text" inputProps={{ inputMode: 'decimal' }} />);

    expect(screen.getByTestId('campo')).toHaveAttribute('inputmode', 'decimal');
  });

  it('puts a top-level autoComplete on the input, not the root', () => {
    render(<Field data-testid="campo" autoComplete="off" />);
    const input = screen.getByTestId('campo');

    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(rootOf(input)).not.toHaveAttribute('autocomplete');
  });
});
