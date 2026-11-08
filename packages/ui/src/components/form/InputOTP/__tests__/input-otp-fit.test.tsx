/**
 * `fit="width"` ON THE WEB (FUT-4585): the slots share the row's width.
 *
 * jsdom lays nothing out, so these read the rules the slots are given rather
 * than measured sizes (the native suite measures; `otpFitBox` is the shared
 * arithmetic). Left out, the row and its slots are drawn exactly as before.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InputOTP } from '../InputOTP';

/** The MUI text field a slot's `<input>` sits in: the box that takes the width. */
const fieldOf = (index: number): HTMLElement =>
  screen.getByTestId(`code-slot-${index}`).closest('.MuiTextField-root') as HTMLElement;

/** A computed length of a slot's text field. */
const lengthOf = (field: HTMLElement, property: 'height' | 'maxWidth'): string => getComputedStyle(field)[property];

/**
 * The slot's `max(side, 2.5rem)`: the field's height held up to the 40px
 * floor. jsdom hands it back as written, or folded to `calc(2.5rem)` when it
 * resolves the larger term itself, so either spelling of that one value passes.
 */
const floorOf = (side: string): RegExp => new RegExp(`^(max\\(${side.replace('.', '\\.')}, 2\\.5rem\\)|calc\\(2\\.5rem\\))$`);

describe('InputOTP fit="width" (web)', () => {
  it('stretches the row and lets every slot share it, never under 32px', () => {
    render(<InputOTP dataTestId="code" fit="width" />);

    expect(screen.getByTestId('code')).toHaveStyle({ width: '100%' });
    expect(screen.getByTestId('code')).not.toHaveAttribute('fit');
    // The prototype's 6px gap, in rem like every length the web writes.
    expect(getComputedStyle(screen.getByTestId('code')).getPropertyValue('gap')).toBe('0.375rem');
    for (let index = 0; index < 6; index += 1) {
      const field = fieldOf(index);
      expect(field).toHaveStyle({ flexGrow: '1', flexBasis: '0', minWidth: '2rem' });
      // Never wider than tall: the square is the cap a wide row stops at.
      expect(lengthOf(field, 'maxWidth')).toMatch(floorOf('2.5rem'));
      expect(lengthOf(field, 'height')).toMatch(floorOf('2.5rem'));
      // The flag that switches the slot's rules stays off the DOM.
      expect(field).not.toHaveAttribute('fitwidth');
      expect(field).not.toHaveAttribute('fitWidth');
    }
  });

  it('lifts a compact slot to the 40px floor', () => {
    render(<InputOTP dataTestId="code" size="xs" fit="width" />);

    // `xs` is a 2rem field, held up to the 2.5rem (40px) floor.
    expect(lengthOf(fieldOf(0), 'height')).toMatch(floorOf('2rem'));
    expect(lengthOf(fieldOf(0), 'maxWidth')).toMatch(floorOf('2rem'));
    expect(fieldOf(0)).toHaveStyle({ minWidth: '2rem' });
  });

  it('keeps the square slot when the option is left out', () => {
    render(<InputOTP dataTestId="code" />);

    expect(screen.getByTestId('code')).not.toHaveStyle({ width: '100%' });
    expect(fieldOf(0)).toHaveStyle({ width: '2.5rem', height: '2.5rem' });
    expect(fieldOf(0)).not.toHaveStyle({ flexGrow: '1' });
  });
});
