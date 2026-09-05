import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { Text as RNText } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import {
  actionsDirection,
  actionStyle,
  descriptionStyle,
  EmptyState,
  helpLinkStyle,
  illustrationStyle,
  titleStyle,
} from './EmptyState.native';
import { MUI_CONTAINED_SHADOW } from './EmptyState.metrics';
import { UiProvider } from '../../../provider/UiProvider.native';
import { createUiTheme } from '../../../tokens/theme';

/**
 * Rendered through react-native-web, so `testID` is `data-testid`, plain style
 * objects land inline and a `Text` with an `href` is an anchor. What is
 * asserted is the NUMBERS — the same ones `EmptyState.tsx` reads from the
 * metrics — not a snapshot.
 */
const theme = createUiTheme();

const action = (label: string) => ({ label, onClick: vi.fn() });

describe('EmptyState (native)', () => {
  it('is a region labelled by its level-3 heading, under the default test id', () => {
    render(<EmptyState title="Nada aqui" />);
    const region = screen.getByRole('region');
    const heading = screen.getByRole('heading', { level: 3, name: 'Nada aqui' });
    expect(region).toHaveAttribute('data-testid', 'empty-state');
    expect(region).toHaveAttribute('aria-labelledby', heading.id);
    expect(heading.tagName).toBe('H3');
    expect(screen.getByTestId('empty-state-title')).toBe(heading);
  });

  it('derives every part id from either spelling of the test id', () => {
    render(
      <>
        <EmptyState
          dataTestId="a"
          title="t"
          description="d"
          illustration={<RNText>i</RNText>}
          primaryAction={action('p')}
          secondaryAction={action('s')}
          onCreate={vi.fn()}
          onRefresh={vi.fn()}
          helpLink={{ label: 'h', href: '#h' }}
        />
        <EmptyState testID="b" title="t" />
      </>,
    );
    const ids = [
      'a', 'a-icon', 'a-title', 'a-description', 'a-primary-action', 'a-create-button',
      'a-secondary-action', 'a-refresh-button', 'a-help-link', 'b', 'b-title',
    ];
    for (const id of ids) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it('renders the description only when given', () => {
    const { rerender } = render(<EmptyState title="t" description="Explica" />);
    expect(screen.getByTestId('empty-state-description')).toHaveTextContent('Explica');
    rerender(<EmptyState title="t" />);
    expect(screen.queryAllByTestId('empty-state-description')).toHaveLength(0);
  });

  it('orders the actions primary, create, secondary, refresh, with the default labels, and fires each once', () => {
    const handlers = { primary: vi.fn(), create: vi.fn(), secondary: vi.fn(), refresh: vi.fn() };
    render(
      <EmptyState
        title="t"
        primaryAction={{ label: 'Criar', onClick: handlers.primary }}
        secondaryAction={{ label: 'Importar', onClick: handlers.secondary }}
        onCreate={handlers.create}
        onRefresh={handlers.refresh}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Criar', 'Create New', 'Importar', 'Refresh']);
    for (const button of buttons) fireEvent.click(button);
    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('icon-Add')).toHaveAttribute('width', '20');
    expect(screen.getByTestId('icon-Add')).toHaveAttribute('fill', theme.palette.primary.contrastText);
    expect(screen.getByTestId('icon-Refresh')).toHaveAttribute('fill', theme.palette.primary.main);
  });

  it('sizes the buttons to MUI contained and outlined medium, 120px wide at least', () => {
    render(<EmptyState title="t" primaryAction={action('p')} secondaryAction={action('s')} />);
    const contained = screen.getByTestId('empty-state-primary-action');
    expect(contained.style.minWidth).toBe('120px');
    expect(contained.style.paddingTop).toBe('6px');
    expect(contained.style.paddingLeft).toBe('16px');
    expect(contained.style.borderTopLeftRadius).toBe('4px');
    expect(contained).toHaveStyle({ backgroundColor: theme.palette.primary.main });
    expect(actionStyle(theme, 'contained')).toMatchObject({ boxShadow: MUI_CONTAINED_SHADOW, overflow: 'visible' });
    expect(contained.getAttribute('style')).toContain('box-shadow');
    const outlined = screen.getByTestId('empty-state-secondary-action');
    expect(outlined.style.paddingTop).toBe('5px');
    expect(outlined.style.paddingLeft).toBe('15px');
    expect(outlined.style.borderTopColor).toBe('rgba(99, 102, 241, 0.5)');
  });

  it('keeps the action row for the action variant even with nothing in it', () => {
    const { rerender } = render(<EmptyState title="t" variant="action" />);
    const content = () => screen.getByTestId('empty-state-title').parentElement as HTMLElement;
    expect(content().childElementCount).toBe(2);
    rerender(<EmptyState title="t" />);
    expect(content().childElementCount).toBe(1);
  });

  it('lays the actions in a row from MUI sm (600px) up and stacks them below', () => {
    expect(actionsDirection(599)).toBe('column');
    expect(actionsDirection(600)).toBe('row');
    render(<EmptyState title="t" dataTestId="w" primaryAction={action('p')} secondaryAction={action('s')} />);
    // jsdom lays nothing out, so react-native-web reads a 0px document and the rendered row stacks.
    const row = screen.getByTestId('w-primary-action').parentElement as HTMLElement;
    expect(row.style.flexDirection).toBe('column');
    expect(row.style.gap).toBe('16px');
    expect(row.style.marginTop).toBe('16px');
    expect(row).toHaveStyle({ alignItems: 'center' });
  });

  it('shows the help link as an anchor, marked and targeted when external', () => {
    const { rerender } = render(<EmptyState title="t" helpLink={{ label: 'Ajuda', href: '/ajuda' }} />);
    const link = screen.getByRole('link', { name: 'Ajuda' });
    expect(link).toBe(screen.getByTestId('empty-state-help-link'));
    expect(link).toHaveAttribute('href', '/ajuda');
    expect(link).not.toHaveAttribute('target');
    expect(link.style.color).toBe('rgb(99, 102, 241)');
    expect(link.style.marginTop).toBe('8px');
    expect(link.style.fontSize).toBe('16px');
    expect(link.style.textDecoration).toBe('none');
    rerender(<EmptyState title="t" helpLink={{ label: 'Docs', href: 'https://x.test', external: true }} />);
    const external = screen.getByRole('link');
    expect(external).toHaveTextContent('Docs ↗');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('sizes and fades the illustration per variant and hides it for minimal', () => {
    expect(illustrationStyle('illustrated')).toMatchObject({ maxWidth: 240, opacity: 0.8, display: 'flex' });
    expect(illustrationStyle('default')).toMatchObject({ maxWidth: 120, opacity: 0.8, display: 'flex' });
    expect(illustrationStyle('minimal')).toMatchObject({ maxWidth: 120, opacity: 0.6, display: 'none' });
    render(<EmptyState title="t" variant="illustrated" illustration={<RNText testID="art">art</RNText>} />);
    const box = screen.getByTestId('empty-state-icon');
    expect(box).toContainElement(screen.getByTestId('art'));
    expect(box.style.maxWidth).toBe('240px');
    expect(box.style.width).toBe('100%');
    expect(box.style.opacity).toBe('0.8');
  });

  it('sets the title in h6 medium and the description in body2 on a 1.6 line height', () => {
    render(<EmptyState title="T" description="D" />);
    const title = screen.getByTestId('empty-state-title').style;
    expect(title.fontSize).toBe('20px');
    expect(title.fontWeight).toBe('500');
    expect(title.lineHeight).toBe('32px');
    expect(title.maxWidth).toBe('400px');
    const description = screen.getByTestId('empty-state-description').style;
    expect(description.fontSize).toBe('14px');
    // 14 * 1.6, with the float noise the browser also carries for a unitless line-height.
    expect(parseFloat(description.lineHeight)).toBeCloseTo(22.4);
    expect(description.maxWidth).toBe('480px');
    expect(titleStyle(theme).color).toBe(theme.palette.text.primary);
    expect(descriptionStyle(theme).color).toBe(theme.palette.text.secondary);
    expect(helpLinkStyle(theme)).toMatchObject({ fontSize: 16, lineHeight: 24, color: theme.palette.primary.main });
  });

  it('lays out like the web: 48px of padding, a 200px floor, 24px between parts, 16px inside the content', () => {
    render(<EmptyState title="T" description="D" dataTestId="e" />);
    const root = screen.getByTestId('e');
    expect(root.style.paddingTop).toBe('48px');
    expect(root.style.minHeight).toBe('200px');
    expect(root.style.gap).toBe('24px');
    expect(root).toHaveStyle({ alignItems: 'center' });
    expect((screen.getByTestId('e-title').parentElement as HTMLElement).style.gap).toBe('16px');
  });

  it('reads the provider theme', () => {
    render(
      <UiProvider theme={{ palette: { primary: '#00897b' } }}>
        <EmptyState title="T" helpLink={{ label: 'h', href: '#' }} primaryAction={action('p')} />
      </UiProvider>,
    );
    expect(screen.getByTestId('empty-state-help-link').style.color).toBe('rgb(0, 137, 123)');
    expect(screen.getByTestId('empty-state-primary-action')).toHaveStyle({ backgroundColor: 'rgb(0, 137, 123)' });
  });

  it('passes View props and a style through to the region', () => {
    render(<EmptyState title="T" dataTestId="v" style={{ marginBottom: 2 }} aria-live="polite" />);
    expect(screen.getByTestId('v').style.marginBottom).toBe('2px');
    expect(screen.getByTestId('v')).toHaveAttribute('aria-live', 'polite');
  });
});
