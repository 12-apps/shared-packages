import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './Checkbox.native';
import {
  CHECKBOX_GLYPH,
  CHECKBOX_GLYPH_SIZES,
  CHECKBOX_HELPER,
  CHECKBOX_LABEL,
  CHECKBOX_PADDING,
  CHECKBOX_VARIANT,
} from './Checkbox.metrics';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

const theme = createUiTheme();

/** The glyph inside the box, by the id `Icon` gives it. */
const glyphOf = (name: string): HTMLElement => screen.getByTestId(`icon-${name}`);

describe('Checkbox (native)', () => {
  it('renders a checkbox role under the web id, unchecked, named by its label', () => {
    render(<Checkbox label="Aceito os termos" />);
    const box = screen.getByRole('checkbox', { name: /aceito os termos/i });
    expect(box).toHaveAttribute('data-testid', 'checkbox');
    expect(box).not.toBeChecked();
    expect(screen.getByTestId('checkbox-container')).toContainElement(box);
    expect(glyphOf(CHECKBOX_GLYPH.unchecked)).toBeInTheDocument();
  });

  it('derives the container and helper ids from the caller id', () => {
    render(<Checkbox dataTestId="terms" label="Aceito" helperText="Obrigatório" />);
    expect(screen.getByTestId('terms')).toHaveAttribute('role', 'checkbox');
    expect(screen.getByTestId('terms-container')).toBeInTheDocument();
    expect(screen.getByTestId('terms-helper')).toHaveTextContent('Obrigatório');
  });

  it('renders the box alone when there is no label, as the web does', async () => {
    render(<Checkbox dataTestId="bare" />);
    await waitFor(() => expect(screen.queryByTestId('bare-container')).not.toBeInTheDocument());
    expect(screen.getByTestId('bare')).toHaveAttribute('role', 'checkbox');
  });

  it('toggles itself and reports the change MUI-shaped', () => {
    const onChange = vi.fn();
    const onClick = vi.fn();
    render(<Checkbox dataTestId="c" onChange={onChange} onClick={onClick} />);
    fireEvent.click(screen.getByTestId('c'));
    expect(onChange).toHaveBeenCalledWith({ target: { checked: true } }, true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('c')).toBeChecked();
    expect(glyphOf(CHECKBOX_GLYPH.checked)).toBeInTheDocument();
  });

  it('starts from defaultChecked and defers to a caller that controls it', () => {
    const { rerender } = render(<Checkbox dataTestId="c" defaultChecked />);
    expect(screen.getByTestId('c')).toBeChecked();
    rerender(<Checkbox dataTestId="c" checked={false} />);
    fireEvent.click(screen.getByTestId('c'));
    expect(screen.getByTestId('c')).not.toBeChecked();
  });

  it('toggles on the space bar, which react-native-web does not press for a checkbox', () => {
    const onChange = vi.fn();
    render(<Checkbox dataTestId="c" onChange={onChange} />);
    fireEvent.keyDown(screen.getByTestId('c'), { key: ' ' });
    expect(onChange).toHaveBeenCalledWith({ target: { checked: true } }, true);
  });

  it('draws the dash glyph and reports mixed while indeterminate', () => {
    render(<Checkbox dataTestId="c" indeterminate />);
    expect(glyphOf(CHECKBOX_GLYPH.indeterminate)).toBeInTheDocument();
    expect(screen.getByTestId('c')).toHaveAttribute('aria-checked', 'mixed');
  });

  it('paints the ink MUI paints: the muted ink off, primary on, disabled greyed', () => {
    render(
      <>
        <Checkbox dataTestId="off" />
        <Checkbox dataTestId="on" checked />
        <Checkbox dataTestId="no" disabled />
      </>,
    );
    // `Icon` fills the glyph and gives the svg the same fill.
    expect(screen.getAllByTestId(`icon-${CHECKBOX_GLYPH.unchecked}`)[0]).toHaveAttribute(
      'fill',
      theme.palette.text.secondary,
    );
    expect(glyphOf(CHECKBOX_GLYPH.checked)).toHaveAttribute('fill', theme.palette.primary.main);
    expect(screen.getAllByTestId(`icon-${CHECKBOX_GLYPH.unchecked}`)[1]).toHaveAttribute(
      'fill',
      theme.palette.action.disabled,
    );
  });

  it('pads the box the way SwitchBase pads it, and sizes the glyph MUI-style', () => {
    render(
      <>
        <Checkbox dataTestId="sm" size="small" />
        <Checkbox dataTestId="md" />
      </>,
    );
    expect(screen.getByTestId('sm')).toHaveStyle({ padding: `${CHECKBOX_PADDING}px` });
    expect(screen.getAllByTestId(`icon-${CHECKBOX_GLYPH.unchecked}`)[0]).toHaveAttribute(
      'width',
      String(CHECKBOX_GLYPH_SIZES.small),
    );
    expect(screen.getAllByTestId(`icon-${CHECKBOX_GLYPH.unchecked}`)[1]).toHaveAttribute(
      'width',
      String(CHECKBOX_GLYPH_SIZES.medium),
    );
  });

  it('rounds and scales the glyph box for the two other variants', () => {
    render(
      <>
        <Checkbox dataTestId="round" variant="rounded" />
        <Checkbox dataTestId="toggle" variant="toggle" />
      </>,
    );
    const boxes = screen.getAllByTestId(`icon-${CHECKBOX_GLYPH.unchecked}`);
    const roundBox = boxes[0]?.parentElement as HTMLElement;
    expect(roundBox).toHaveStyle({ borderTopLeftRadius: `${CHECKBOX_GLYPH_SIZES.medium / 2}px` });
    const toggleBox = boxes[1]?.parentElement as HTMLElement;
    expect(toggleBox).toHaveStyle({ borderTopLeftRadius: `${CHECKBOX_VARIANT.toggle.radius}px` });
    expect(toggleBox.style.transform).toContain(`scale(${CHECKBOX_VARIANT.toggle.scale})`);
  });

  it('turns a spinner over the box while loading, and refuses the press', () => {
    const onChange = vi.fn();
    render(<Checkbox dataTestId="c" loading onChange={onChange} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByTestId('c')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('c'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sets the label at MUI body2 and swaps both inks for the error hue', () => {
    const { rerender } = render(<Checkbox dataTestId="c" label="Aceito" helperText="Ajuda" />);
    const label = screen.getByText('Aceito');
    expect(label.style.fontSize).toBe(`${CHECKBOX_LABEL.fontSize}px`);
    expect(label).toHaveStyle({ color: theme.palette.text.primary });
    expect(screen.getByTestId('c-helper')).toHaveStyle({
      marginLeft: `${theme.spacingUnit * CHECKBOX_HELPER.marginLeftUnits}px`,
    });

    rerender(<Checkbox dataTestId="c" label="Aceito" helperText="Ajuda" error />);
    expect(screen.getByText('Aceito')).toHaveStyle({ color: theme.palette.danger.main });
    expect(screen.getByTestId('c-helper')).toHaveStyle({ color: theme.palette.danger.main });
  });

  it('reads the provider theme for the ink it checks with', () => {
    render(
      <UiProvider theme={{ palette: { primary: '#00897b' } }}>
        <Checkbox dataTestId="t" checked />
      </UiProvider>,
    );
    expect(glyphOf(CHECKBOX_GLYPH.checked)).toHaveAttribute('fill', '#00897b');
  });
});
