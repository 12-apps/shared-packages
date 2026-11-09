import { createTheme } from '@mui/material/styles/index.js';
import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { emittedCss } from '../../layout/SettingCard/__tests__/emitted-css';
import { getContrastRatio } from '../../../tokens/color';
import { createUiTheme } from '../../../tokens/theme';
import { FormHoldProvider, useFormHold } from '../FormHold';
import { FormContainer, SubmitButton } from '../total-form';
import { Button } from './Button';
import { HELD_LABEL_MIN_CONTRAST, heldColors } from './Button.held';

function Uploading(): null {
  useFormHold('photo', true);
  return null;
}

describe('a held submit', () => {
  it('stays focusable and says it is held: aria-disabled, never disabled', () => {
    render(
      <FormContainer initialValues={{}} onSubmit={vi.fn()}>
        <Uploading />
        <SubmitButton>Save</SubmitButton>
      </FormContainer>,
    );
    const save = screen.getByTestId('total-form-submit');
    expect(save).toBeEnabled();
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toHaveAttribute('tabindex', '-1');
  });

  it('a click does not submit, nor does Enter on it', () => {
    const onSubmit = vi.fn();
    const onClick = vi.fn();
    render(
      <FormContainer initialValues={{}} onSubmit={onSubmit}>
        <Uploading />
        <Button type="submit" dataTestId="save" onClick={onClick}>
          Save
        </Button>
      </FormContainer>,
    );
    const save = screen.getByTestId('save');
    fireEvent.click(save);
    // A browser turns Enter on a focused button into a click; jsdom does not.
    fireEvent.keyDown(save, { key: 'Enter' });
    fireEvent.click(save, { detail: 0 });
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a host disabled still disables natively', () => {
    render(
      <FormHoldProvider>
        <Uploading />
        <Button type="submit" dataTestId="save" disabled>
          Save
        </Button>
      </FormHoldProvider>,
    );
    expect(screen.getByTestId('save')).toBeDisabled();
  });

  it('carries the focus-visible ring on its own class', () => {
    render(
      <FormHoldProvider>
        <Uploading />
        <Button type="submit" dataTestId="save">
          Save
        </Button>
      </FormHoldProvider>,
    );
    const css = emittedCss(screen.getByTestId('save'));
    expect(css).toMatch(/:focus-visible[^{]*\{[^}]*outline:[^;]*solid/);
    expect(css).toMatch(/outline-offset:/);
  });
});

describe('a button with progress', () => {
  it('carries the focus-visible ring on its own class', () => {
    render(
      <Button dataTestId="publish" progress={{ fraction: 0.4, label: 'Sending photo · ~5 s' }}>
        Publish
      </Button>,
    );
    const css = emittedCss(screen.getByTestId('publish'));
    expect(css).toMatch(/:focus-visible[^{]*\{[^}]*outline:[^;]*solid/);
  });
});

describe('the held look reads (3:1) on the disabled tokens', () => {
  it.each([
    ['this package, light', createUiTheme()],
    ['this package, dark', createUiTheme({ mode: 'dark' })],
    ['MUI default, light', createTheme()],
    ['MUI default, dark', createTheme({ palette: { mode: 'dark' } })],
  ])('%s', (_name, theme) => {
    const { color, backgroundColor } = heldColors(theme);
    expect(getContrastRatio(color, backgroundColor)).toBeGreaterThanOrEqual(HELD_LABEL_MIN_CONTRAST);
    // Visibly unlike the live button, whose background is the primary colour.
    expect(backgroundColor).not.toBe(theme.palette.primary.main);
  });
});
