/**
 * `inputProps` REACH THE `<input>`, MERGED (FUT-2823).
 *
 * An attribute `Input` does not recognise lands on the text field's ROOT
 * `<div>` — so `inputMode="numeric"` passed at the top level raised no numeric
 * keypad anywhere, because a div has no keyboard to choose. `inputProps` is the
 * route to the element itself, and it is merged rather than spread over: the
 * field's `data-testid` and the ARIA it builds must survive a caller's object.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../Input';

const rootOf = (input: HTMLElement) => input.closest('.MuiFormControl-root') as HTMLElement;

describe('Input: inputProps land on the <input>', () => {
  it('puts inputMode, pattern and role on the input, not the root', () => {
    render(<Input data-testid="campo" inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', role: 'spinbutton' }} />);
    const input = screen.getByTestId('campo');

    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('pattern', '[0-9]*');
    expect(input).toHaveAttribute('role', 'spinbutton');
    expect(rootOf(input)).not.toHaveAttribute('inputmode');
  });

  it('keeps the field-built aria-describedby over a caller inputProps value', () => {
    render(
      <Input
        data-testid="campo"
        helperText="Ajuda"
        aria-describedby="extra"
        inputProps={{ 'aria-describedby': 'ignored' }}
      />,
    );
    const input = screen.getByTestId('campo');

    expect(input.getAttribute('aria-describedby')).toMatch(/-helper-text extra$/);
  });

  it('lets a caller inputProps test id stand in when none is given at the top level', () => {
    render(<Input inputProps={{ 'data-testid': 'por-dentro' }} />);

    expect(screen.getByTestId('por-dentro').tagName).toBe('INPUT');
  });

  it('puts a top-level readOnly on the input, not the root', () => {
    render(<Input readOnly value="x" onChange={() => undefined} data-testid="f" />);
    const input = screen.getByTestId('f') as HTMLInputElement;

    expect(input.tagName).toBe('INPUT');
    expect(input.readOnly).toBe(true);
    expect(input).toHaveAttribute('readonly');
    expect(rootOf(input)).not.toHaveAttribute('readonly');
  });

  it("lets a caller's inputProps.readOnly win over the top-level one", () => {
    render(<Input readOnly inputProps={{ readOnly: false }} value="x" onChange={() => undefined} data-testid="f" />);
    const input = screen.getByTestId('f') as HTMLInputElement;

    expect(input.readOnly).toBe(false);
    expect(rootOf(input)).not.toHaveAttribute('readonly');
  });

  it('leaves the input editable when readOnly is not given', () => {
    render(<Input defaultValue="x" data-testid="f" />);

    expect((screen.getByTestId('f') as HTMLInputElement).readOnly).toBe(false);
  });
});
