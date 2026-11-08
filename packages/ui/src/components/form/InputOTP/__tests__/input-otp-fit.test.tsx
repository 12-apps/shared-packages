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

describe('InputOTP fit="width" (web)', () => {
  it('stretches the row and lets every slot share it, never under 32px', () => {
    render(<InputOTP dataTestId="code" fit="width" />);

    expect(screen.getByTestId('code')).toHaveStyle({ width: '100%' });
    expect(screen.getByTestId('code')).not.toHaveAttribute('fit');
    for (let index = 0; index < 6; index += 1) {
      expect(fieldOf(index)).toHaveStyle({ flexGrow: '1', flexBasis: '0', minWidth: '2rem' });
    }
  });

  it('keeps the square slot when the option is left out', () => {
    render(<InputOTP dataTestId="code" />);

    expect(screen.getByTestId('code')).not.toHaveStyle({ width: '100%' });
    expect(fieldOf(0)).toHaveStyle({ width: '2.5rem', height: '2.5rem' });
    expect(fieldOf(0)).not.toHaveStyle({ flexGrow: '1' });
  });
});
