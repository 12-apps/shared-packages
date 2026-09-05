import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './Select.native';
import { SELECT_ICON, SELECT_MENU, selectedWashAlpha } from './Select.metrics';
import { UiProvider } from '../../../provider/UiProvider.native';
import { alpha } from '../../../tokens/color';
import { resolveFieldEdge } from '../../../tokens/field-edge.core';
import { createUiTheme } from '../../../tokens/theme';
import { MUI_INPUT_PADDING, INPUT_BORDER } from '../Input/Input.metrics';

const theme = createUiTheme();
const edge = resolveFieldEdge(theme.palette.divider, theme.palette.background.paper);

const OPTIONS = [
  { value: 'option1', label: 'Option 1' },
  { value: 'option2', label: 'Option 2' },
  { value: 'option3', label: 'Option 3 (Disabled)', disabled: true },
];

/** Open the list the way a shopper does. */
const openList = (testId = 'select'): void => {
  fireEvent.click(screen.getByTestId(testId));
};

describe('Select (native)', () => {
  it('renders a combobox under the web ids, closed, with the placeholder showing', async () => {
    render(<Select options={OPTIONS} placeholder="Escolha" />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('data-testid', 'select');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Escolha');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('derives the trigger and the option ids from the caller id, as the web does', () => {
    render(<Select dataTestId="country" options={OPTIONS} />);
    expect(screen.getByTestId('country')).toBeInTheDocument();
    openList('country-select');
    expect(screen.getByTestId('country-option-option1')).toHaveTextContent('Option 1');
    expect(screen.getByTestId('country-option-option3')).toHaveAttribute('aria-disabled', 'true');
  });

  it('opens and closes on press, and reports both edges', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<Select options={OPTIONS} onOpen={onOpen} onClose={onClose} />);
    openList();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledTimes(1);
    openList();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and opens on the arrow keys', async () => {
    render(<Select options={OPTIONS} />);
    openList();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('reports a pick as MUI does — a target-shaped event and the option itself', async () => {
    const onChange = vi.fn();
    render(<Select dataTestId="s" options={OPTIONS} onChange={onChange} />);
    openList('s-select');
    fireEvent.click(screen.getByTestId('s-option-option2'));
    expect(onChange).toHaveBeenCalledWith({ target: { value: 'option2' } }, OPTIONS[1]);
    expect(screen.getByRole('combobox')).toHaveTextContent('Option 2');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('holds the value itself when the caller does not, and defers to it when it does', () => {
    const { rerender } = render(<Select dataTestId="s" options={OPTIONS} defaultValue="option2" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Option 2');

    rerender(<Select dataTestId="s" options={OPTIONS} value="option1" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Option 1');
    openList('s-select');
    fireEvent.click(screen.getByTestId('s-option-option2'));
    // Controlled: the display follows the caller's value, not the press.
    expect(screen.getByRole('combobox')).toHaveTextContent('Option 1');
  });

  it('shows the LAST option matching the value, as MUI resolves a duplicate', () => {
    render(
      <Select
        dataTestId="s"
        placeholder="Escolha"
        options={[{ value: '', label: 'Vazio' }, ...OPTIONS]}
      />,
    );
    // Both the placeholder and the empty-valued option answer to '': MUI shows
    // the one it walks last.
    expect(screen.getByRole('combobox')).toHaveTextContent('Vazio');
  });

  it('gives the placeholder a disabled row with no test id of its own', () => {
    render(<Select dataTestId="s" placeholder="Escolha" options={OPTIONS} />);
    openList('s-select');
    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(OPTIONS.length + 1);
    expect(rows[0]).toHaveAttribute('aria-disabled', 'true');
    expect(rows[0]).not.toHaveAttribute('data-testid');
  });

  it('washes the chosen row and fades a disabled one, at MUI opacities', () => {
    render(<Select dataTestId="s" options={OPTIONS} defaultValue="option1" />);
    openList('s-select');
    expect(screen.getByTestId('s-option-option1')).toHaveStyle({
      backgroundColor: alpha(theme.palette.primary.main, selectedWashAlpha(theme)),
    });
    expect(screen.getByTestId('s-option-option3')).toHaveStyle({
      opacity: String(SELECT_MENU.disabledOpacity),
    });
    expect(screen.getByTestId('s-option-option1')).toHaveStyle({
      minHeight: `${SELECT_MENU.itemMinHeight}px`,
      paddingLeft: `${SELECT_MENU.itemPaddingHorizontal}px`,
    });
  });

  it('draws the outlined box the Input draws, and thickens it while open', () => {
    render(<Select dataTestId="s" options={OPTIONS} />);
    const trigger = screen.getByTestId('s-select');
    expect(trigger).toHaveStyle({ borderTopColor: edge, borderTopWidth: `${INPUT_BORDER.rest}px` });
    expect(trigger.style.paddingLeft).toBe(
      `${MUI_INPUT_PADDING.outlined.medium.left - INPUT_BORDER.rest}px`,
    );
    // The arrow's own inset, so the value still stops 32px from the edge.
    expect(trigger.style.paddingRight).toBe(`${SELECT_ICON.right - INPUT_BORDER.rest}px`);
    openList('s-select');
    expect(trigger).toHaveStyle({
      borderTopColor: theme.palette.primary.main,
      borderTopWidth: `${INPUT_BORDER.focused}px`,
    });
  });

  it('paints the error hue and stays shut while disabled', async () => {
    render(
      <>
        <Select dataTestId="bad" options={OPTIONS} error helperText="Obrigatório" />
        <Select dataTestId="off" options={OPTIONS} disabled />
      </>,
    );
    expect(screen.getByTestId('bad-select')).toHaveStyle({
      borderTopColor: theme.palette.danger.main,
    });
    expect(screen.getByText('Obrigatório')).toHaveStyle({ color: theme.palette.danger.main });
    expect(screen.getByTestId('off-select')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('off-select'));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('names itself through the label and the helper text', () => {
    render(<Select dataTestId="s" options={OPTIONS} label="País" helperText="Onde você mora" />);
    const trigger = screen.getByTestId('s-select');
    const labelId = trigger.getAttribute('aria-labelledby');
    const helperId = trigger.getAttribute('aria-describedby');
    expect(labelId).toBeTruthy();
    expect(helperId).toBeTruthy();
    expect(document.getElementById(labelId as string)).toHaveTextContent('País');
    expect(document.getElementById(helperId as string)).toHaveTextContent('Onde você mora');
  });

  it('is a tab stop with the arrow MUI draws, turned over while open', () => {
    render(<Select dataTestId="s" options={OPTIONS} />);
    expect(screen.getByTestId('s-select')).toHaveAttribute('tabindex', '0');
    const icon = screen.getByTestId('s-select-icon');
    expect(icon).toHaveAttribute('width', String(SELECT_ICON.size));
    expect(icon.style.transform).toBe('');
    openList('s-select');
    expect(screen.getByTestId('s-select-icon').style.transform).toContain(
      `${SELECT_ICON.openRotateDeg}deg`,
    );
  });

  it('reads the provider theme for the box it draws while open', () => {
    render(
      <UiProvider theme={{ palette: { primary: '#00897b' } }}>
        <Select dataTestId="t" options={OPTIONS} />
      </UiProvider>,
    );
    openList('t-select');
    expect(screen.getByTestId('t-select')).toHaveStyle({ borderTopColor: 'rgb(0, 137, 123)' });
  });

  it('renders the pulse bar only while pulsing', async () => {
    const { rerender } = render(<Select dataTestId="p" options={OPTIONS} pulse />);
    expect(screen.getByTestId('p-select-pulse')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Select dataTestId="p" options={OPTIONS} />);
    await waitFor(() => expect(screen.queryByTestId('p-select-pulse')).not.toBeInTheDocument());
  });
});
