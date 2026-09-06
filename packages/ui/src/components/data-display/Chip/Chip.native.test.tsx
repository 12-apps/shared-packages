import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { chipPaint } from './Chip.look.native';
import { Chip } from './Chip.native';
import { CHIP_RADIUS, CHIP_SIZES } from './Chip.metrics';
import { UiProvider } from '../../../provider/UiProvider.native';
import { alpha, hexToRgb } from '../../../tokens/color';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid`, `role` and
 * `aria-selected` reach the DOM, and a `Pressable` gets its own tab stop. What
 * is asserted is the NUMBERS — MUI's chip geometry, restated in `Chip.metrics`.
 */
const theme = createUiTheme();

/** A hex from the palette, as the DOM normalises it in a resolved style. */
const paint = (color: string): string => (color.startsWith('#') ? hexToRgb(color) : color);

describe('Chip (native)', () => {
  it('is a 32px pill under the default id, with the label inside it', () => {
    render(<Chip label="Etiqueta" />);
    const chip = screen.getByTestId('chip');
    expect(chip.style.height).toBe(`${CHIP_SIZES.medium.height}px`);
    expect(chip.style.borderTopLeftRadius).toBe(`${CHIP_RADIUS}px`);
    expect(chip.style.backgroundColor).toBe(paint(theme.palette.primary.main));
    const label = screen.getByTestId('chip-label');
    expect(label).toHaveTextContent('Etiqueta');
    expect(label.style.fontSize).toBe('13px');
    expect(label.style.paddingLeft).toBe(`${CHIP_SIZES.medium.labelPadding}px`);
    expect(label.style.color).toBe(paint(theme.palette.primary.contrastText));
  });

  it('draws MUI\'s two heights across the five house sizes', () => {
    render(
      <>
        <Chip label="xs" size="xs" dataTestId="xs" />
        <Chip label="sm" size="sm" dataTestId="sm" />
        <Chip label="md" size="md" dataTestId="md" />
        <Chip label="xl" size="xl" dataTestId="xl" />
      </>,
    );
    expect(screen.getByTestId('xs').style.height).toBe('24px');
    expect(screen.getByTestId('sm').style.height).toBe('24px');
    expect(screen.getByTestId('md').style.height).toBe('32px');
    expect(screen.getByTestId('xl').style.height).toBe('32px');
    expect(screen.getByTestId('sm-label').style.paddingLeft).toBe(
      `${CHIP_SIZES.small.labelPadding}px`,
    );
  });

  it('outlines with the hue at 0.7 and tightens the label by a pixel', () => {
    render(<Chip label="Contorno" variant="outlined" dataTestId="o" />);
    const chip = screen.getByTestId('o').style;
    // jsdom normalises `transparent` to its rgba form.
    expect(chip.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(chip.borderTopWidth).toBe('1px');
    expect(chip.borderTopColor).toBe(alpha(theme.palette.primary.main, 0.7));
    expect(screen.getByTestId('o-label').style.paddingLeft).toBe(
      `${CHIP_SIZES.medium.labelPaddingOutlined}px`,
    );
    expect(screen.getByTestId('o-label').style.color).toBe(paint(theme.palette.primary.main));
  });

  it('paints neutral as MUI\'s unaccented default, ink and all', () => {
    render(
      <>
        <Chip label="n" color="neutral" dataTestId="n" />
        <Chip label="no" color="neutral" variant="outlined" dataTestId="no" />
      </>,
    );
    expect(screen.getByTestId('n').style.backgroundColor).toBe(theme.palette.action.selected);
    expect(screen.getByTestId('n-label').style.color).toBe(theme.palette.text.primary);
    expect(screen.getByTestId('no').style.borderTopColor).toBe(paint(theme.palette.grey[400]));
    expect(chipPaint(theme, 'filled', 'danger', false).container.backgroundColor).toBe(
      theme.palette.danger.main,
    );
  });

  it('tints a selected outlined chip and leaves a filled one solid', () => {
    render(
      <>
        <Chip label="s" selectable selected variant="outlined" dataTestId="s" />
        <Chip label="f" selectable selected dataTestId="f" />
      </>,
    );
    expect(screen.getByTestId('s').style.backgroundColor).toBe(theme.palette.action.selected);
    expect(screen.getByTestId('f').style.backgroundColor).toBe(paint(theme.palette.primary.main));
  });

  it('is an option when selectable, a button when it merely acts, and roleless otherwise', () => {
    render(
      <>
        <Chip label="a" selectable dataTestId="a" />
        <Chip label="b" onClick={() => undefined} dataTestId="b" />
        <Chip label="c" dataTestId="c" />
      </>,
    );
    expect(screen.getByTestId('a')).toHaveAttribute('role', 'option');
    expect(screen.getByTestId('b')).toHaveAttribute('role', 'button');
    expect(screen.getByTestId('c')).not.toHaveAttribute('role');
  });

  it('reports selection only when it is selectable', () => {
    render(
      <>
        <Chip label="a" selectable selected dataTestId="a" />
        <Chip label="b" selected dataTestId="b" />
      </>,
    );
    expect(screen.getByTestId('a')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('b')).not.toHaveAttribute('aria-selected');
  });

  it('takes a tab stop only when it acts', () => {
    render(
      <>
        <Chip label="a" onClick={() => undefined} dataTestId="a" />
        <Chip label="b" dataTestId="b" />
        <Chip label="c" disabled onClick={() => undefined} dataTestId="c" />
      </>,
    );
    expect(screen.getByTestId('a')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('b')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('c')).toHaveAttribute('tabindex', '-1');
  });

  it('fires both handler spellings on a press, and neither when disabled', () => {
    const onClick = vi.fn();
    const onPress = vi.fn();
    render(
      <>
        <Chip label="a" onClick={onClick} onPress={onPress} dataTestId="a" />
        <Chip label="b" disabled onClick={onClick} dataTestId="b" />
      </>,
    );
    fireEvent.click(screen.getByTestId('a'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('b'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('fades a disabled chip by MUI\'s disabled opacity', () => {
    render(<Chip label="x" disabled dataTestId="d" />);
    expect(screen.getByTestId('d').style.opacity).toBe('0.38');
  });

  it('gives the delete button MUI\'s glyph size, tuck and ink', () => {
    const onDelete = vi.fn();
    render(<Chip label="x" deletable onDelete={onDelete} dataTestId="d" />);
    const remove = screen.getByTestId('d-delete');
    expect(remove.style.marginLeft).toBe(`${CHIP_SIZES.medium.deleteMarginLeft}px`);
    expect(remove.style.marginRight).toBe(`${CHIP_SIZES.medium.deleteMarginRight}px`);
    const glyph = remove.querySelector('svg');
    expect(glyph?.getAttribute('width')).toBe(`${CHIP_SIZES.medium.deleteSize}`);
    expect(glyph?.getAttribute('fill')).toBe(alpha(theme.palette.primary.contrastText, 0.7));
    fireEvent.click(remove);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows no delete button until the chip is deletable', () => {
    render(<Chip label="x" onDelete={() => undefined} dataTestId="d" />);
    expect(screen.queryAllByTestId('d-delete')).toHaveLength(0);
  });

  it('tucks a leading icon under the label and names its slot', () => {
    render(
      <Chip
        label="x"
        icon={<span data-testid="glyph">*</span>}
        dataTestId="i"
      />,
    );
    const slot = screen.getByTestId('i-icon');
    expect(slot.style.marginLeft).toBe(`${CHIP_SIZES.medium.iconMarginLeft}px`);
    expect(slot.style.marginRight).toBe(`${CHIP_SIZES.medium.iconMarginRight}px`);
    expect(slot).toContainElement(screen.getByTestId('glyph'));
  });

  it('draws an avatarSrc as a round image at MUI\'s box', () => {
    render(<Chip label="x" avatarSrc="https://example.test/a.jpg" dataTestId="a" />);
    const image = screen.getByTestId('a').querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://example.test/a.jpg');
    expect((image?.parentElement as HTMLElement).style.width).toBe(
      `${CHIP_SIZES.medium.avatarSize}px`,
    );
  });

  it('honours both spellings of the chip id', () => {
    render(
      <>
        <Chip label="a" testID="a" />
        <Chip label="b" dataTestId="b" />
      </>,
    );
    expect(screen.getByTestId('a-label')).toHaveTextContent('a');
    expect(screen.getByTestId('b-label')).toHaveTextContent('b');
  });

  it('activates a selectable chip on Space and removes a deletable one on Delete', () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    render(
      <Chip label="x" selectable deletable onClick={onClick} onDelete={onDelete} dataTestId="k" />,
    );
    const chip = screen.getByTestId('k');
    // Space is the half react-native-web's `Pressable` leaves to us: it answers
    // Enter on any role, and Space only on a `button` role.
    fireEvent.keyDown(chip, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(chip, { key: 'Delete' });
    expect(onDelete).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(chip, { key: 'Backspace' });
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it('answers no key at all while disabled', () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    render(
      <Chip label="x" disabled selectable deletable onClick={onClick} onDelete={onDelete} dataTestId="k" />,
    );
    fireEvent.keyDown(screen.getByTestId('k'), { key: ' ' });
    fireEvent.keyDown(screen.getByTestId('k'), { key: 'Delete' });
    expect(onClick).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('reads the provider theme', () => {
    const dark = createUiTheme({ mode: 'dark' });
    render(
      <UiProvider theme={dark}>
        <Chip label="x" color="neutral" variant="outlined" dataTestId="d" />
      </UiProvider>,
    );
    expect(screen.getByTestId('d').style.borderTopColor).toBe(paint(dark.palette.grey[700]));
    expect(screen.getByTestId('d-label').style.color).toBe(paint(dark.palette.text.primary));
  });
});
