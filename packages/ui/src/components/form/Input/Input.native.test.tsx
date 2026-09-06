import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Input } from './Input.native';
import {
  ADORNMENT_GAP,
  HELPER_TEXT,
  INPUT_BORDER,
  INPUT_FONT_SIZE,
  INPUT_LINE_HEIGHT,
  INPUT_LOADING,
  MUI_INPUT_PADDING,
  inputPadding,
} from './Input.metrics';
import { Icon } from '../../../icons/Icon.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';
import { resolveFieldEdge } from '../../../tokens/field-edge.core';

const theme = createUiTheme();
const edge = resolveFieldEdge(theme.palette.divider, theme.palette.background.paper);

/**
 * The field box the border is drawn on. It carries no test id of its own — the
 * web names only the `<input>`, so the native field names only the `TextInput`
 * — and it is that element's parent.
 */
const fieldOf = (testId: string): HTMLElement => screen.getByTestId(testId).parentElement as HTMLElement;
/** The whole control: label, field and helper. */
const rootOf = (testId: string): HTMLElement => fieldOf(testId).parentElement as HTMLElement;

describe('Input (native)', () => {
  it('renders the value under the default test id, with the label as its name', () => {
    render(<Input label="Nome" placeholder="Seu nome" />);
    const input = screen.getByTestId('input');
    expect(input).toHaveAttribute('placeholder', 'Seu nome');
    expect(screen.getByLabelText('Nome')).toBe(input);
    expect(screen.getByText('Nome')).toBeInTheDocument();
  });

  it('names ONE element, as the web does: the value, under the caller id', () => {
    render(<Input dataTestId="email" label="E-mail" helperText="Obrigatório" />);
    expect(screen.getByTestId('email')).toBeInTheDocument();
    // The label and the helper are text, not test ids — a story that counts
    // fields by an id prefix must count the same number on both renderers.
    expect(screen.queryAllByTestId(/^email/)).toHaveLength(1);
    expect(rootOf('email')).toHaveTextContent('E-mail');
    expect(rootOf('email')).toHaveTextContent('Obrigatório');
  });

  it('types at MUI body1 on its 23px line, inset by the outlined medium padding', () => {
    render(<Input dataTestId="f" />);
    const style = screen.getByTestId('f').style;
    expect(style.fontSize).toBe(`${INPUT_FONT_SIZE}px`);
    expect(style.lineHeight).toBe(`${INPUT_LINE_HEIGHT}px`);
    // The border is free on the web, so the inset gives its width back.
    const padding = MUI_INPUT_PADDING.outlined.medium;
    expect(style.paddingTop).toBe(`${padding.top - INPUT_BORDER.rest}px`);
    expect(fieldOf('f').style.paddingLeft).toBe(`${padding.left - INPUT_BORDER.rest}px`);
  });

  it.each(['xs', 'sm', 'md', 'lg', 'xl'] as const)('size %s pads like the web', (size) => {
    render(<Input dataTestId={size} size={size} />);
    const padding = inputPadding('outlined', size);
    expect(screen.getByTestId(size).style.paddingTop).toBe(`${padding.top - INPUT_BORDER.rest}px`);
    expect(fieldOf(size).style.paddingLeft).toBe(`${padding.left - INPUT_BORDER.rest}px`);
  });

  it('draws the resting outline at the field edge and thickens it on focus', () => {
    render(<Input dataTestId="f" />);
    const field = fieldOf('f');
    // react-native-web writes the longhands.
    expect(field).toHaveStyle({ borderTopColor: edge, borderTopWidth: `${INPUT_BORDER.rest}px` });
    // React 17+ listens for `focusin`, which is what `focusIn` dispatches.
    fireEvent.focusIn(screen.getByTestId('f'));
    expect(field).toHaveStyle({
      borderTopColor: theme.palette.primary.main,
      borderTopWidth: `${INPUT_BORDER.focused}px`,
    });
    // The value does not move: the inset gives back exactly what the border took.
    expect(screen.getByTestId('f').style.paddingTop).toBe(
      `${MUI_INPUT_PADDING.outlined.medium.top - INPUT_BORDER.focused}px`,
    );
  });

  it('paints error and disabled ahead of focus, and greys the ink out', () => {
    render(
      <>
        <Input dataTestId="bad" error helperText="Inválido" />
        <Input dataTestId="off" disabled />
      </>,
    );
    expect(fieldOf('bad')).toHaveStyle({ borderTopColor: theme.palette.danger.main });
    expect(screen.getByTestId('bad')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Inválido')).toHaveStyle({ color: theme.palette.danger.main });
    expect(fieldOf('off')).toHaveStyle({ borderTopColor: theme.palette.action.disabled });
    expect(screen.getByTestId('off')).toBeDisabled();
    expect(screen.getByTestId('off')).toHaveStyle({ color: theme.palette.text.disabled });
  });

  it('gives each variant its own edges: filled and underline rule only the bottom', () => {
    render(
      <>
        <Input dataTestId="filled" variant="filled" />
        <Input dataTestId="under" variant="underline" />
        <Input dataTestId="glass" variant="glass" />
      </>,
    );
    const filled = fieldOf('filled');
    expect(filled.style.borderBottomWidth).toBe(`${INPUT_BORDER.rest}px`);
    expect(filled.style.borderTopWidth).toBe('');
    expect(filled).toHaveStyle({ borderTopLeftRadius: `${theme.radius.md}px` });
    expect(fieldOf('under').style.borderBottomWidth).toBe(`${INPUT_BORDER.rest}px`);
    expect(fieldOf('under').style.borderTopWidth).toBe('');
    // `glass` washes the paper at 0.1 and keeps a border on every side.
    expect(fieldOf('glass')).toHaveStyle({ backgroundColor: 'rgba(255, 255, 255, 0.1)' });
    expect(fieldOf('glass').style.borderTopWidth).toBe(`${INPUT_BORDER.rest}px`);
  });

  it('replaces the end adornment with a spinner while loading, and goes inert', async () => {
    const { rerender } = render(
      <Input dataTestId="q" endAdornment={<Icon name="Search" />} />,
    );
    const endSlot = screen.getByTestId('icon-Search').parentElement as HTMLElement;
    expect(endSlot).toHaveStyle({ marginLeft: `${ADORNMENT_GAP}px` });
    expect(screen.getByTestId('q').nextElementSibling).toBe(endSlot);

    rerender(<Input dataTestId="q" endAdornment={<Icon name="Search" />} loading />);
    await waitFor(() => expect(screen.queryByTestId('icon-Search')).not.toBeInTheDocument());
    expect(screen.getByTestId('q-loading')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    // `editable={false}` for a device, `disabled` for the DOM: only the second
    // takes the field out of the tab order, and only the first exists natively.
    expect(screen.getByTestId('q')).toBeDisabled();
    expect(screen.getByTestId('q')).toHaveAttribute('readonly');
    expect(screen.getByTestId('q')).toHaveAttribute('aria-disabled', 'true');
  });

  it('fades the whole control while loading, as the web fades the form control', () => {
    render(<Input dataTestId="q" loading label="Buscando" helperText="Aguarde" />);
    expect(rootOf('q')).toHaveStyle({ opacity: String(INPUT_LOADING.opacity) });
  });

  it('puts the start adornment before the value, 8px from it', () => {
    render(<Input dataTestId="s" startAdornment={<Icon name="Search" />} />);
    const start = screen.getByTestId('icon-Search').parentElement as HTMLElement;
    expect(start).toHaveStyle({ marginRight: `${ADORNMENT_GAP}px` });
    expect(start.nextElementSibling).toBe(screen.getByTestId('s'));
  });

  it('maps the HTML type onto a keyboard and secure entry', () => {
    render(
      <>
        <Input dataTestId="mail" type="email" />
        <Input dataTestId="pass" type="password" />
        <Input dataTestId="plain" type="text" />
      </>,
    );
    expect(screen.getByTestId('mail')).toHaveAttribute('type', 'email');
    expect(screen.getByTestId('pass')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('plain')).toHaveAttribute('type', 'text');
  });

  it('fires onClick and onPress, both spelled, and reports changes', () => {
    const onClick = vi.fn();
    const onPress = vi.fn();
    const onChangeText = vi.fn();
    render(<Input dataTestId="go" onClick={onClick} onPress={onPress} onChangeText={onChangeText} />);
    fireEvent.click(screen.getByTestId('go'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByTestId('go'), { target: { value: 'oi' } });
    expect(onChangeText).toHaveBeenCalledWith('oi');
  });

  it('sets the helper text in caption type, 3px under the field', () => {
    render(<Input dataTestId="h" helperText="Ajuda" />);
    const helper = screen.getByText('Ajuda');
    expect(helper.style.fontSize).toBe(`${HELPER_TEXT.fontSize}px`);
    expect(helper.style.marginTop).toBe(`${HELPER_TEXT.marginTop}px`);
    expect(helper.style.marginLeft).toBe(`${HELPER_TEXT.marginHorizontal}px`);
  });

  it('marks a required field for assistive technology and in the label', () => {
    render(<Input dataTestId="r" label="Nome" required />);
    expect(screen.getByTestId('r')).toHaveAttribute('aria-required', 'true');
    expect(rootOf('r')).toHaveTextContent('Nome *');
    expect(screen.getByLabelText('Nome')).toBe(screen.getByTestId('r'));
  });

  it('reads the provider theme for its focused outline', () => {
    render(
      <UiProvider theme={{ palette: { primary: '#00897b' } }}>
        <Input dataTestId="t" />
      </UiProvider>,
    );
    fireEvent.focusIn(screen.getByTestId('t'));
    expect(fieldOf('t')).toHaveStyle({ borderTopColor: 'rgb(0, 137, 123)' });
  });

  it('renders the pulse bar only while pulsing', async () => {
    const { rerender } = render(<Input dataTestId="p" pulse />);
    expect(screen.getByTestId('p-pulse')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Input dataTestId="p" />);
    await waitFor(() => expect(screen.queryByTestId('p-pulse')).not.toBeInTheDocument());
  });

  it('stretches by default and shrinks to its content when told not to', () => {
    render(
      <>
        <Input dataTestId="wide" label="A" />
        <Input dataTestId="slim" label="B" fullWidth={false} />
      </>,
    );
    expect(rootOf('wide')).toHaveStyle({ width: '100%' });
    expect(rootOf('slim')).toHaveStyle({ alignSelf: 'flex-start' });
  });
});
