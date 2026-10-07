/**
 * `SectionNav`'s compact form (FUT-3373): icons only, a size down, for a host
 * that folds its chrome so the content gets the screen. Nothing may be lost
 * but the drawing — every control keeps its name, its count and its act.
 */
import { createTheme } from '@mui/material/styles/index.js';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_SECTION_NAV_COPY } from '../../../../en-US.navigation';
import { SectionNav } from '../SectionNav';
import { sectionNavBarInset } from '../SectionNav.bar';
import { RaisedActionButton } from '../SectionNav.primary';
import type { SectionNavDestination, SectionNavMenu } from '../SectionNav.types';

afterEach(cleanup);

const icon = <svg data-testid="icon" />;

const DESTINATIONS: SectionNavDestination[] = [
  { id: 'floor', label: 'Floor', icon, href: '/floor', active: true },
  { id: 'board', label: 'Board', icon, href: '/board', badge: 3 },
  { id: 'serve', label: 'Serve', icon, href: '/serve' },
];

const PRIMARY: SectionNavMenu = {
  label: 'Create',
  icon,
  title: 'Create now',
  groups: [{ id: 'order', title: 'New order', entries: [{ id: 'delivery', label: 'Delivery', icon, onSelect: vi.fn() }] }],
};

const MORE: SectionNavMenu = {
  label: 'More',
  icon,
  title: 'More places',
  groups: [{ id: 'rest', title: 'Shift', entries: [{ id: 'queue', label: 'Queue', icon, href: '/queue', badge: 2 }] }],
};

/** Out of sight the way `VISUALLY_HIDDEN` hides it: still in the tree, clipped away. */
function expectVisuallyHidden(element: HTMLElement): void {
  const style = getComputedStyle(element);
  expect(style.position).toBe('absolute');
  expect(style.overflow).toBe('hidden');
  expect(style.clip).toMatch(/^rect\(0(px)?, 0(px)?, 0(px)?, 0(px)?\)$/);
}

describe('sectionNavBarInset', () => {
  const theme = createTheme();

  it('is the 60px bar by default and the 48px bar when compact, safe area included', () => {
    expect(sectionNavBarInset(theme)).toBe(`calc(${theme.typography.pxToRem(60)} + env(safe-area-inset-bottom))`);
    expect(sectionNavBarInset(theme, { compact: false })).toBe(sectionNavBarInset(theme));
    expect(sectionNavBarInset(theme, { compact: true })).toBe(
      `calc(${theme.typography.pxToRem(48)} + env(safe-area-inset-bottom))`,
    );
  });
});

describe('SectionNav bar, compact', () => {
  it('draws no label but keeps each slot named, titled and counted', () => {
    render(
      <SectionNav
        layout="bar"
        label="Operations"
        destinations={DESTINATIONS}
        more={MORE}
        copy={EN_US_SECTION_NAV_COPY}
        compact
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Operations' });
    const board = within(nav).getByRole('link', { name: /Board/ });
    expect(board).toHaveAttribute('title', 'Board');
    // The label folds away (no height, no ink) but stays in the tree as the name.
    const words = getComputedStyle(within(board).getByText('Board'));
    expect(words.maxHeight).toBe('0');
    expect(words.opacity).toBe('0');
    expect(words.display).not.toBe('none');
    expect(within(board).getByLabelText('3 pending')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /Floor/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByTestId('section-nav-more')).toHaveAttribute('title', 'More');
  });

  it('keeps the labels drawn when not compact, with no tooltip', () => {
    render(<SectionNav layout="bar" label="Operations" destinations={DESTINATIONS} copy={EN_US_SECTION_NAV_COPY} />);
    const board = screen.getByRole('link', { name: /Board/ });
    expect(board).not.toHaveAttribute('title');
    expect(getComputedStyle(within(board).getByText('Board')).opacity).toBe('1');
  });

  it('still opens the raised menu, named as before', () => {
    render(
      <SectionNav
        layout="bar"
        label="Operations"
        destinations={DESTINATIONS}
        primary={PRIMARY}
        copy={EN_US_SECTION_NAV_COPY}
        compact
      />,
    );
    const button = screen.getByTestId('section-nav-primary');
    expect(button).toHaveAttribute('aria-label', 'Create');
    // The bar hands its size down: the raised button is the compact one, named on hover too.
    expect(getComputedStyle(button).width).toBe(createTheme().typography.pxToRem(40));
    expect(button).toHaveAttribute('title', 'Create');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Create now')).toBeInTheDocument();
  });
});

describe('RaisedActionButton, compact', () => {
  it('is 40px rather than 52, and draws no caption even when captioned', () => {
    const theme = createTheme();
    const { rerender } = render(
      <RaisedActionButton label="Send" icon={icon} onClick={vi.fn()} captioned dataTestId="raised" />,
    );
    expect(getComputedStyle(screen.getByTestId('raised')).width).toBe(theme.typography.pxToRem(52));
    expect(screen.getByText('Send')).toBeInTheDocument();

    rerender(<RaisedActionButton label="Send" icon={icon} onClick={vi.fn()} captioned compact dataTestId="raised" />);
    expect(getComputedStyle(screen.getByTestId('raised')).width).toBe(theme.typography.pxToRem(40));
    // The button's own box holds no words: its caption is not drawn.
    expect(screen.getByTestId('raised').parentElement).not.toHaveTextContent('Send');
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });
});

describe('SectionNav rail, compact', () => {
  it('draws every row, the way back and the headings as names only', () => {
    render(
      <SectionNav
        layout="rail"
        label="Operations"
        destinations={DESTINATIONS}
        more={MORE}
        back={{ label: 'Back', href: '/', icon }}
        heading="Operation"
        copy={EN_US_SECTION_NAV_COPY}
        compact
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Operations' });
    const board = within(nav).getByRole('link', { name: /Board/ });
    expect(board).toHaveAttribute('title', 'Board');
    expectVisuallyHidden(within(board).getByText('Board').parentElement as HTMLElement);
    expect(within(board).getByLabelText('3 pending')).toBeInTheDocument();

    const back = within(nav).getByTestId('section-nav-back');
    expect(back).toHaveAttribute('title', 'Back');
    expectVisuallyHidden(within(back).getByText('Back'));

    expectVisuallyHidden(within(nav).getByText('Operation'));
    expectVisuallyHidden(within(nav).getByText('More places'));
    expectVisuallyHidden(within(nav).getByText('Shift'));
    expect(within(nav).getByRole('link', { name: /Queue/ })).toHaveAttribute('title', 'Queue');
  });

  it('folds the create button to its icon, still named, and it still opens its menu', () => {
    render(
      <SectionNav
        layout="rail"
        label="Operations"
        destinations={DESTINATIONS}
        primary={PRIMARY}
        copy={EN_US_SECTION_NAV_COPY}
        compact
      />,
    );
    const create = screen.getByTestId('section-nav-primary');
    expect(create).toHaveAccessibleName('Create');
    expect(create).toHaveAttribute('title', 'Create');
    expect(create).not.toHaveTextContent('Create');
    fireEvent.click(create);
    expect(screen.getByRole('menu', { name: 'Create now' })).toBeInTheDocument();
  });

  it('draws the arrow for a way back that brings no icon, since the icon is all it shows', () => {
    render(
      <SectionNav
        layout="rail"
        label="Operations"
        destinations={DESTINATIONS}
        back={{ label: 'Back', href: '/' }}
        copy={EN_US_SECTION_NAV_COPY}
        compact
      />,
    );
    const back = screen.getByTestId('section-nav-back');
    expect(back.querySelector('svg')).not.toBeNull();
    expect(back).toHaveAccessibleName('Back');
  });

  it('leaves the default way back as it was: its own height, no drawn arrow added', () => {
    render(
      <SectionNav
        layout="rail"
        label="Operations"
        destinations={DESTINATIONS}
        back={{ label: 'Back', href: '/' }}
        copy={EN_US_SECTION_NAV_COPY}
      />,
    );
    const back = screen.getByTestId('section-nav-back');
    expect(getComputedStyle(back).minHeight).toBe('');
    expect(back.querySelectorAll('svg')).toHaveLength(0);
    expect(back).toHaveTextContent('Back');
  });

  it('keeps the rail as it was when not compact', () => {
    render(
      <SectionNav
        layout="rail"
        label="Operations"
        destinations={DESTINATIONS}
        primary={PRIMARY}
        copy={EN_US_SECTION_NAV_COPY}
      />,
    );
    expect(screen.getByTestId('section-nav-primary')).toHaveTextContent('Create');
    expect(screen.getByRole('link', { name: /Board/ })).not.toHaveAttribute('title');
  });
});
