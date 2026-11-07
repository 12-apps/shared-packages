import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { InputOTP } from './InputOTP.native';
import { OTP_BORDER } from './InputOTP.metrics';
import { createUiTheme } from '../../../tokens/theme';
import { resolveFieldEdge } from '../../../tokens/field-edge.core';
import { DEFAULT_FIELD_HEIGHT, fieldHeightPx } from '../../../tokens/field-height.core';

const theme = createUiTheme();
const edge = resolveFieldEdge(theme.palette.divider, theme.palette.background.paper);
const box = (index: number): HTMLInputElement => screen.getByTestId(`otp-slot-${index}`) as HTMLInputElement;
const type = (index: number, text: string): void => {
  fireEvent.change(box(index), { target: { value: text } });
};

/** A controlled field, the way every caller drives it. */
function Controlled(props: { onComplete?: (code: string) => void; error?: boolean }): React.JSX.Element {
  const [value, setValue] = React.useState('');
  return <InputOTP dataTestId="otp" aria-label="Código da loja" value={value} onChange={setValue} {...props} />;
}

describe('InputOTP (native)', () => {
  it('draws six square boxes in one row, named together as a group', () => {
    render(<Controlled />);
    const group = screen.getByRole('group', { name: 'Código da loja' });
    expect(group).toBe(screen.getByTestId('otp'));
    expect(group).toHaveStyle({ display: 'flex', flexDirection: 'row' });
    const side = fieldHeightPx(DEFAULT_FIELD_HEIGHT, 'md');
    for (let index = 0; index < 6; index += 1) {
      expect(box(index)).toHaveStyle({ width: `${side}px`, height: `${side}px` });
    }
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('asks for the number pad on every box and the SMS code on the first', () => {
    render(<Controlled />);
    expect(box(0)).toHaveAttribute('inputmode', 'numeric');
    expect(box(5)).toHaveAttribute('inputmode', 'numeric');
    expect(box(0)).toHaveAttribute('autocomplete', 'one-time-code');
    expect(box(1)).not.toHaveAttribute('autocomplete', 'one-time-code');
    expect(box(0)).toHaveAttribute('maxlength', '7');
    expect(box(1)).toHaveAttribute('maxlength', '1');
  });

  it('types forward, one digit per box, and reports the code once it is whole', async () => {
    const onComplete = vi.fn();
    render(<Controlled onComplete={onComplete} />);
    '48291'.split('').forEach((digit, index) => type(index, digit));
    await waitFor(() => expect(box(5)).toHaveFocus());
    expect(onComplete).not.toHaveBeenCalled();
    type(5, '3');
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('482913'));
    expect(box(5)).toHaveValue('3');
  });

  it('refuses a letter in a numeric box', async () => {
    render(<Controlled />);
    type(0, 'a');
    await waitFor(() => expect(box(0)).toHaveValue(''));
  });

  it('spreads a whole code filled into the first box across all six', async () => {
    const onComplete = vi.fn();
    render(<Controlled onComplete={onComplete} />);
    type(0, '482913');
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('482913'));
    expect([0, 1, 2, 3, 4, 5].map((index) => box(index).value)).toEqual(['4', '8', '2', '9', '1', '3']);
  });

  it('drops the digit already in the first box when the phone inserts the code before it', async () => {
    const onComplete = vi.fn();
    render(<Controlled onComplete={onComplete} />);
    type(0, '4');
    type(0, '4482913');
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('482913'));
  });

  it('spreads an alphanumeric code pasted into the first box, without capitals or autocorrect', async () => {
    const onComplete = vi.fn();
    render(<InputOTP dataTestId="otp" variant="alphanumeric" onComplete={onComplete} />);
    expect(box(0)).toHaveAttribute('autocapitalize', 'none');
    expect(box(0)).toHaveAttribute('autocorrect', 'off');
    type(0, 'AB12CD');
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('AB12CD'));
  });

  it('steps back on Backspace in an empty box', async () => {
    render(<Controlled />);
    type(0, '4');
    await waitFor(() => expect(box(1)).toHaveFocus());
    fireEvent.keyDown(box(1), { key: 'Backspace' });
    await waitFor(() => expect(box(0)).toHaveFocus());
  });

  it('draws the error border on every box and keeps the digits', () => {
    const { rerender } = render(<InputOTP dataTestId="otp" value="482913" />);
    expect(box(0)).toHaveStyle({ borderTopColor: edge, borderTopWidth: `${OTP_BORDER.rest}px` });
    rerender(<InputOTP dataTestId="otp" value="482913" error />);
    for (let index = 0; index < 6; index += 1) {
      expect(box(index)).toHaveStyle({ borderTopColor: theme.palette.danger.main });
      expect(box(index)).toHaveAttribute('aria-invalid', 'true');
    }
    expect(box(2)).toHaveValue('2');
  });

  it('thickens the focused box in the accent colour', () => {
    render(<Controlled />);
    fireEvent.focusIn(box(2));
    expect(box(2)).toHaveStyle({ borderTopColor: theme.palette.primary.main, borderTopWidth: `${OTP_BORDER.focused}px` });
    expect(box(1)).toHaveStyle({ borderTopWidth: `${OTP_BORDER.rest}px` });
  });

  it('takes nothing while disabled, and fades its border as the web does', () => {
    render(<InputOTP dataTestId="otp" disabled />);
    expect(box(0)).toBeDisabled();
    expect(box(0)).toHaveStyle({ borderTopColor: theme.palette.action.disabled });
  });
});
