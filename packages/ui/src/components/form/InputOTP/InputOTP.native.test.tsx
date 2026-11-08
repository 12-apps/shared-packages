import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { InputOTP } from './InputOTP.native';
import { OTP_BORDER, OTP_FIT_GAP_PX, OTP_FONT_PX, otpFitBox } from './InputOTP.metrics';
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

/**
 * `fit="width"` (FUT-4585): the courier's code sheet at phone widths. The row
 * is the sheet's content box, a 320 / 360 / 390 phone less 24 on each side.
 *
 * The row's width reaches the component through `onLayout`, which
 * react-native-web measures from a ResizeObserver and the element's offset box
 * — neither of which jsdom lays out — so both are supplied here.
 */
describe('InputOTP (native) fit="width"', () => {
  const layout: { notify?: ResizeObserverCallback } = {};

  /** react-native-web builds ONE observer for every `onLayout`, on first use. */
  class LayoutObserver {
    constructor(notify: ResizeObserverCallback) {
      layout.notify = notify;
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', LayoutObserver);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  /** Lays the row out `width` wide; react-native-web reports it on the next tick. */
  function layOut(width: number): void {
    const row = screen.getByTestId('otp');
    Object.defineProperty(row, 'offsetWidth', { configurable: true, value: width });
    Object.defineProperty(row, 'offsetHeight', { configurable: true, value: 48 });
    act(() => {
      layout.notify?.([{ target: row } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    });
  }

  const lg = fieldHeightPx(DEFAULT_FIELD_HEIGHT, 'lg');

  /**
   * A box's type size, as written on it. Read off the element's own style:
   * jsdom resolves react-native-web's `font` shorthand class over it.
   */
  const fontOf = (index: number): string => box(index).style.fontSize;

  it.each([
    // phone, row, box width: 6 boxes + 5 gaps of 6 fill the row, floored
    [320, 272, 40],
    [360, 312, 47],
    // wide enough for squares: the box stops at its own height
    [390, 342, lg],
  ])('draws portrait boxes that fit a %ipx phone\'s %ipx row at size lg', async (_phone, row, width) => {
    render(<InputOTP dataTestId="otp" size="lg" fit="width" value="482913" />);
    layOut(row);
    await waitFor(() => expect(box(0)).toHaveStyle({ width: `${width}px` }));
    for (let index = 0; index < 6; index += 1) {
      expect(box(index)).toHaveStyle({ width: `${width}px`, height: `${lg}px` });
      expect(fontOf(index)).toBe(`${OTP_FONT_PX.lg}px`);
    }
    expect(lg).toBeGreaterThanOrEqual(40);
    expect(6 * width + 5 * OTP_FIT_GAP_PX).toBeLessThanOrEqual(row);
    const rowStyle = getComputedStyle(screen.getByTestId('otp'));
    expect(rowStyle.alignSelf).toBe('stretch');
    expect(rowStyle.getPropertyValue('gap')).toBe(`${OTP_FIT_GAP_PX}px`);
  });

  it.each([
    [320, 272],
    [360, 312],
    [390, 342],
  ])('keeps the md font and a 40px floor at a %ipx phone\'s %ipx row', async (_phone, row) => {
    render(<InputOTP dataTestId="otp" fit="width" />);
    layOut(row);
    const expected = otpFitBox(row, fieldHeightPx(DEFAULT_FIELD_HEIGHT, 'md'), 6);
    await waitFor(() => expect(box(0)).toHaveStyle({ width: `${expected.width}px` }));
    expect(expected.height).toBeGreaterThanOrEqual(40);
    expect(box(0)).toHaveStyle({ height: `${expected.height}px` });
    expect(fontOf(0)).toBe(`${OTP_FONT_PX.md}px`);
  });

  it('lifts a compact size to the 40px floor and keeps its own type', async () => {
    render(<InputOTP dataTestId="otp" size="xs" fit="width" />);
    layOut(272);
    await waitFor(() => expect(box(0)).toHaveStyle({ width: '40px', height: '40px' }));
    expect(fontOf(0)).toBe(`${OTP_FONT_PX.xs}px`);
  });

  it('shares the row by flex until the row has been measured', () => {
    render(<InputOTP dataTestId="otp" size="lg" fit="width" />);
    expect(box(0)).toHaveStyle({ height: `${lg}px`, maxWidth: `${lg}px`, minWidth: '32px', flexGrow: '1' });
  });
});

describe('otpFitBox', () => {
  it('never narrows a box under 32, however narrow the row', () => {
    expect(otpFitBox(100, 48, 6)).toEqual({ width: 32, height: 48 });
  });

  it('keeps squares on a wide row', () => {
    expect(otpFitBox(1000, 48, 6)).toEqual({ width: 48, height: 48 });
  });
});
