/**
 * THE NATIVE SIX-BOX CODE INPUT.
 *
 * Rendered through react-native-web, so each slot is a real `<input>` and the
 * queries the web tests use keep working. What a device alone can answer — the
 * keypad it actually opens, the SMS suggestion strip, Yoga's widths — is the
 * harness's job; here the props that ask for them are asserted.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { InputOTP } from './InputOTP.native';
import { OTP_BORDER, OTP_FONT_PX } from './InputOTP.metrics';
import type { InputOTPProps } from './InputOTP.types.native';
import { PT_BR_UI_LABELS } from '../../../pt-BR.labels';
import { createUiTheme } from '../../../tokens/theme';
import { resolveFieldEdge } from '../../../tokens/field-edge.core';
import { fieldHeightPx } from '../../../tokens/field-height.core';

const theme = createUiTheme();
const edge = resolveFieldEdge(theme.palette.divider, theme.palette.background.paper);
const SIDE = fieldHeightPx(theme.fieldHeight, 'md');
const GAP = theme.spacing(1);
const DANGER = theme.palette.danger.main;
const ACCENT = theme.palette.primary.main;

/** Slot `index`, queried fresh each time so no test holds an element across renders. */
const slotAt = (index: number): HTMLInputElement => screen.getByTestId(`code-slot-${index}`) as HTMLInputElement;
const indexes = (length = 6): number[] => Array.from({ length }, (_, i) => i);
/** What every slot shows, left to right. */
const shown = (length = 6): string[] => indexes(length).map((i) => slotAt(i).value);

function renderOtp(props: Partial<InputOTPProps> = {}) {
  const onChange = vi.fn();
  const onComplete = vi.fn();
  const view = render(
    <InputOTP dataTestId="code" aria-label="Store code" onChange={onChange} onComplete={onComplete} {...props} />,
  );
  return { ...view, onChange, onComplete };
}

/** A controlled host, as a screen holds the code in its own state. */
function Controlled(props: Partial<InputOTPProps>) {
  const [code, setCode] = React.useState(props.value ?? '');
  return (
    <InputOTP
      dataTestId="code"
      {...props}
      value={code}
      onChange={(next) => {
        setCode(next);
        props.onChange?.(next);
      }}
    />
  );
}

/** The text a slot now holds — a keystroke, a deletion, or a whole code from a paste or the SMS fill. */
const enter = (index: number, text: string) => fireEvent.change(slotAt(index), { target: { value: text } });
const press = (index: number, name: string) => fireEvent.keyDown(slotAt(index), { key: name });

describe('InputOTP (native): the row', () => {
  it('draws six slots in ONE row, as a group named by aria-label', () => {
    renderOtp();
    const group = screen.getByRole('group', { name: 'Store code' });

    expect(group).toBe(screen.getByTestId('code'));
    expect(screen.getAllByTestId(/^code-slot-/)).toHaveLength(6);
    for (const i of indexes()) expect(slotAt(i).parentElement).toBe(group);
    expect(group).toHaveStyle({ flexDirection: 'row', flexWrap: 'nowrap', gap: `${GAP}px` });
  });

  it('names each slot by its position, from the labels pack', () => {
    renderOtp({ labels: PT_BR_UI_LABELS.inputOtp });

    expect(screen.getByLabelText('Dígito 1 de 6')).toBe(slotAt(0));
    expect(screen.getByLabelText('Dígito 6 de 6')).toBe(slotAt(5));
  });

  it('falls back to the English slot names when the host passes none', () => {
    renderOtp();

    expect(screen.getByLabelText('Digit 3 of 6')).toBe(slotAt(2));
  });

  it('draws each slot as a square of the field height that may shrink, so the row never wraps at 320', () => {
    renderOtp();

    for (const i of indexes()) {
      const { style } = slotAt(i);
      expect(style.height).toBe(`${SIDE}px`);
      expect(style.maxWidth).toBe(`${SIDE}px`);
      expect(style.flexShrink).toBe('1');
      expect(style.minWidth).toBe('0px');
      expect(style.fontSize).toBe(`${OTP_FONT_PX.md}px`);
      expect(style.textAlign).toBe('center');
    }
  });

  it('asks for the number pad on every slot and the one-time-code fill on the first only', () => {
    renderOtp({ variant: 'numeric' });

    expect(slotAt(0)).toHaveAttribute('inputmode', 'numeric');
    expect(slotAt(0)).toHaveAttribute('autocomplete', 'one-time-code');
    for (const i of indexes().slice(1)) {
      expect(slotAt(i)).toHaveAttribute('inputmode', 'numeric');
      expect(slotAt(i)).not.toHaveAttribute('autocomplete', 'one-time-code');
    }
  });

  it('leaves the text keyboard to the alphanumeric variant', () => {
    renderOtp({ variant: 'alphanumeric' });

    expect(slotAt(0)).not.toHaveAttribute('inputmode', 'numeric');
    expect(slotAt(0)).not.toHaveAttribute('autocomplete', 'one-time-code');
  });
});

describe('InputOTP (native): typing', () => {
  it('fills the slot and moves focus forward', async () => {
    const { onChange } = renderOtp();

    enter(0, '4');

    await waitFor(() => expect(slotAt(1)).toHaveFocus());
    expect(slotAt(0)).toHaveValue('4');
    expect(onChange).toHaveBeenLastCalledWith('4');
  });

  it('takes digits only', async () => {
    const { onChange } = renderOtp();

    enter(0, 'a');

    await waitFor(() => expect(slotAt(0)).toHaveValue(''));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('fires onComplete ONCE, with the code, at the sixth digit', async () => {
    const onComplete = vi.fn();
    render(<Controlled onComplete={onComplete} />);

    '48291'.split('').forEach((digit, i) => enter(i, digit));
    await waitFor(() => expect(slotAt(4)).toHaveValue('1'));
    expect(onComplete).not.toHaveBeenCalled();

    enter(5, '3');

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith('482913');
  });

  it('ignores a second keystroke into the filled first slot', async () => {
    const { onChange } = renderOtp({ value: '4' });

    enter(0, '47');

    await waitFor(() => expect(slotAt(0)).toHaveValue('4'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('InputOTP (native): a whole code in the first slot', () => {
  it('spreads a pasted or SMS-filled code across all six', async () => {
    const { onChange, onComplete } = renderOtp();

    enter(0, '482913');

    await waitFor(() => expect(shown()).toEqual(['4', '8', '2', '9', '1', '3']));
    expect(onChange).toHaveBeenLastCalledWith('482913');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('482913');
  });

  it('drops the digit the phone left in front of an inserted code', async () => {
    const { onComplete } = renderOtp({ value: '4' });

    enter(0, '4482913');

    await waitFor(() => expect(shown()).toEqual(['4', '8', '2', '9', '1', '3']));
    expect(onComplete).toHaveBeenCalledWith('482913');
  });

  it('lets the first slot take the code plus that one digit', () => {
    renderOtp();

    expect(slotAt(0)).toHaveAttribute('maxlength', '7');
    for (const i of indexes().slice(1)) expect(slotAt(i)).toHaveAttribute('maxlength', '1');
  });

  it('refuses a fill that is not all digits', async () => {
    const { onChange } = renderOtp();

    enter(0, '48a913');

    await waitFor(() => expect(slotAt(0)).toHaveValue(''));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('InputOTP (native): moving back', () => {
  it('steps back on Backspace in an empty slot', async () => {
    renderOtp({ value: '48' });

    press(2, 'Backspace');

    await waitFor(() => expect(slotAt(1)).toHaveFocus());
    expect(slotAt(1)).toHaveValue('8');
  });

  it('clears a filled slot on Backspace without publishing a step back', async () => {
    const { onChange } = renderOtp({ value: '48' });

    press(1, 'Backspace');
    enter(1, '');

    await waitFor(() => expect(slotAt(1)).toHaveValue(''));
    expect(onChange).toHaveBeenLastCalledWith('4');
  });

  it('walks the row with the arrow keys', async () => {
    renderOtp();

    press(1, 'ArrowRight');
    await waitFor(() => expect(slotAt(2)).toHaveFocus());

    press(2, 'ArrowLeft');
    await waitFor(() => expect(slotAt(1)).toHaveFocus());
  });
});

describe('InputOTP (native): states', () => {
  it('draws every slot in the error border and keeps the digits', () => {
    renderOtp({ value: '482913', error: true });

    expect(shown()).toEqual(['4', '8', '2', '9', '1', '3']);
    for (const i of indexes()) {
      expect(slotAt(i)).toHaveStyle({ borderTopColor: DANGER });
      expect(slotAt(i)).toHaveAttribute('aria-invalid', 'true');
    }
  });

  it('draws the field edge at rest and the accent ring on the slot typing moved to', async () => {
    renderOtp();

    enter(0, '4');

    await waitFor(() =>
      expect(slotAt(1)).toHaveStyle({ borderTopColor: ACCENT, borderTopWidth: `${OTP_BORDER.focused}px` }),
    );
    expect(slotAt(2)).toHaveStyle({ borderTopColor: edge, borderTopWidth: `${OTP_BORDER.rest}px` });
  });

  it('disables every slot', () => {
    renderOtp({ disabled: true });

    for (const i of indexes()) expect(slotAt(i)).toBeDisabled();
  });

  it('shows a bullet for each masked digit and publishes the digit itself', async () => {
    const { onChange } = renderOtp({ variant: 'masked' });

    enter(0, '7');

    await waitFor(() => expect(slotAt(0)).toHaveValue('•'));
    expect(onChange).toHaveBeenLastCalledWith('7');
  });

  it('follows a new controlled value', async () => {
    const { rerender } = renderOtp({ value: '48' });

    rerender(<InputOTP dataTestId="code" value="" />);

    await waitFor(() => expect(shown()).toEqual(['', '', '', '', '', '']));
  });
});
