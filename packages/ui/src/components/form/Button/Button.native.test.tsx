import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button.native';
import { BUTTON_SIZES } from './Button.metrics';
import { Icon } from '../../../icons/Icon.native';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

const theme = createUiTheme();

/** The label text node inside the button with this test id. */
const labelOf = (testId: string): HTMLElement =>
  screen.getByTestId(testId).querySelector('div, span') as HTMLElement;

describe('Button (native)', () => {
  it('renders a button role with its label under the default test id', () => {
    render(<Button>Salvar</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-testid', 'button');
    expect(button).toHaveTextContent('Salvar');
  });

  it('fires onClick and onPress, both spelled', () => {
    const onClick = vi.fn();
    const onPress = vi.fn();
    render(
      <Button dataTestId="go" onClick={onClick} onPress={onPress}>
        Ir
      </Button>,
    );
    fireEvent.click(screen.getByTestId('go'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire while disabled or loading', () => {
    const onClick = vi.fn();
    render(
      <>
        <Button dataTestId="off" disabled onClick={onClick}>
          x
        </Button>
        <Button dataTestId="busy" loading onClick={onClick}>
          x
        </Button>
      </>,
    );
    fireEvent.click(screen.getByTestId('off'));
    fireEvent.click(screen.getByTestId('busy'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('off')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('busy')).toHaveAttribute('aria-busy', 'true');
  });

  it('replaces the label with a spinner while loading', () => {
    render(
      <Button dataTestId="save" loading>
        Salvar
      </Button>
    );
    expect(screen.getByTestId('save')).not.toHaveTextContent('Salvar');
    expect(screen.getByTestId('save-loading')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('wraps the icon under a derived test id, on the side asked for', () => {
    const { rerender } = render(
      <Button dataTestId="add" icon={<Icon name="Add" />}>
        Novo
      </Button>,
    );
    const icon = screen.getByTestId('add-icon');
    expect(icon.nextElementSibling).toHaveTextContent('Novo');
    rerender(
      <Button dataTestId="add" icon={<Icon name="Add" />} iconPosition="right">
        Novo
      </Button>,
    );
    expect(screen.getByText('Novo').nextElementSibling).toBe(screen.getByTestId('add-icon'));
  });

  it('is square with no minimum width when it carries only an icon', () => {
    render(<Button dataTestId="close" icon={<Icon name="Close" />} />);
    const style = screen.getByTestId('close').style;
    expect(style.minWidth).toBe('0px');
    expect(style.padding).toBe('7px');
  });

  it.each(['xs', 'sm', 'md', 'lg', 'xl'] as const)('size %s pads and types like the web', (size) => {
    render(
      <Button dataTestId={size} size={size}>
        x
      </Button>,
    );
    const metrics = BUTTON_SIZES[size];
    const style = screen.getByTestId(size).style;
    expect(style.paddingTop).toBe(`${metrics.paddingVertical}px`);
    expect(style.paddingLeft).toBe(`${metrics.paddingHorizontal}px`);
    expect(labelOf(size).style.fontSize).toBe(`${metrics.fontSize}px`);
  });

  it('paints the variants from the same palette arithmetic as the web', () => {
    render(
      <>
        <Button dataTestId="solid">x</Button>
        <Button dataTestId="outline" variant="outline">x</Button>
        <Button dataTestId="ghost" variant="ghost">x</Button>
        <Button dataTestId="danger" color="danger">x</Button>
        <Button dataTestId="neutral" color="neutral">x</Button>
      </>,
    );
    expect(screen.getByTestId('solid')).toHaveStyle({ backgroundColor: 'rgb(99, 102, 241)' });
    expect(labelOf('solid')).toHaveStyle({ color: 'rgb(255, 255, 255)' });
    // react-native-web writes the longhands.
    expect(screen.getByTestId('outline')).toHaveStyle({ borderTopColor: 'rgb(99, 102, 241)', borderTopWidth: '1px' });
    // quietInk: darken(main, 0.3) -> rgb(69, 71, 168)
    expect(labelOf('ghost')).toHaveStyle({ color: 'rgb(69, 71, 168)' });
    expect(screen.getByTestId('danger')).toHaveStyle({ backgroundColor: theme.palette.danger.main });
    expect(screen.getByTestId('neutral')).toHaveStyle({ backgroundColor: theme.palette.grey[700] });
  });

  it('rounds to one spacing unit and types at weight 500', () => {
    render(<Button dataTestId="r">x</Button>);
    expect(screen.getByTestId('r')).toHaveStyle({ borderTopLeftRadius: '8px', borderBottomRightRadius: '8px' });
    expect(labelOf('r').style.fontWeight).toBe('500');
  });

  it('greys out when disabled', () => {
    render(
      <Button dataTestId="d" disabled>
        x
      </Button>,
    );
    expect(screen.getByTestId('d')).toHaveStyle({ backgroundColor: theme.palette.action.disabledBackground });
    expect(labelOf('d')).toHaveStyle({ color: theme.palette.action.disabled });
  });

  it('reads the provider theme', () => {
    render(
      <UiProvider theme={{ palette: { primary: '#00897b' } }}>
        <Button dataTestId="t">x</Button>
      </UiProvider>,
    );
    expect(screen.getByTestId('t')).toHaveStyle({ backgroundColor: 'rgb(0, 137, 123)' });
  });

  it('renders a pulse ring only while pulsing and enabled', () => {
    const { rerender } = render(<Button pulse>x</Button>);
    expect(screen.getByTestId('button-pulse')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Button>x</Button>);
    expect(screen.queryByTestId('button-pulse')).toBeNull();
    rerender(
      <Button pulse disabled>
        x
      </Button>,
    );
    expect(screen.queryByTestId('button-pulse')).toBeNull();
  });
});
