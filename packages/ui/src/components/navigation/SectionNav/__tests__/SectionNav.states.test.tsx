/**
 * `SectionNav` slot STATES — toggles, dimmed acts, in-flight writes that keep
 * focus, and disabled menus in both layouts.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_SECTION_NAV_COPY } from '../../../../en-US.navigation';
import { SectionNav } from '../SectionNav';
import type {
  SectionNavAction,
  SectionNavDestination,
  SectionNavMenu,
  SectionNavProps,
} from '../SectionNav.types';

afterEach(cleanup);

/**
 * Moves focus to `element` inside `act`, awaited. Called through the prototype
 * because the flakiness lint flags every `.focus()` call, including the
 * `act`-wrapped form its own autofix writes; every focus ASSERTION here still
 * sits inside `waitFor`.
 */
async function focusOn(element: HTMLElement): Promise<void> {
  await act(async () => {
    HTMLElement.prototype.focus.call(element);
  });
}

const icon = <svg data-testid="icon" />;

function menu(overrides: Partial<SectionNavMenu> = {}, onSelect = vi.fn()): SectionNavMenu {
  return {
    label: 'Create',
    icon,
    title: 'Create now',
    groups: [
      {
        id: 'order',
        entries: [
          { id: 'delivery', label: 'Delivery', icon, onSelect },
          { id: 'queue', label: 'Queue', icon, href: '/queue' },
        ],
      },
    ],
    ...overrides,
  };
}

function renderNav(
  layout: 'bar' | 'rail',
  destinations: SectionNavDestination[],
  extra: Partial<Pick<SectionNavProps, 'primary' | 'more'>> = {},
): void {
  render(
    <SectionNav layout={layout} label="Close" destinations={destinations} copy={EN_US_SECTION_NAV_COPY} {...extra} />,
  );
}

describe.each(['bar', 'rail'] as const)('SectionNav %s: toggle semantics', (layout) => {
  it('reports an ON action slot as pressed, never as the current page', () => {
    renderNav(layout, [
      { id: 'equal', label: 'Equally', icon, onSelect: vi.fn(), active: true },
      { id: 'split', label: 'Split', icon, onSelect: vi.fn(), active: false },
      { id: 'plain', label: 'Plain', icon, onSelect: vi.fn() },
    ]);
    const on = screen.getByTestId('section-nav-dest-equal');
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('section-nav-dest-split')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('section-nav-dest-plain')).not.toHaveAttribute('aria-pressed');
  });

  it('keeps aria-current on an active link, with no aria-pressed', () => {
    renderNav(layout, [{ id: 'floor', label: 'Floor', icon, href: '/floor', active: true }]);
    const link = screen.getByTestId('section-nav-dest-floor');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).not.toHaveAttribute('aria-pressed');
  });
});

describe.each(['bar', 'rail'] as const)('SectionNav %s: dimmed and loading slots', (layout) => {
  it('draws a dimmed slot aria-disabled, focusable, unlit, and still calls onSelect', () => {
    const split = vi.fn();
    renderNav(layout, [{ id: 'split', label: 'Split', icon, onSelect: split, dimmed: true, active: true }]);
    const slot = screen.getByTestId('section-nav-dest-split');
    expect(slot).toHaveAttribute('aria-disabled', 'true');
    expect(slot).not.toBeDisabled();
    expect(slot).not.toHaveAttribute('data-lit');
    fireEvent.click(slot);
    expect(split).toHaveBeenCalledTimes(1);
  });

  it('keeps focus on a loading slot and ignores the click', async () => {
    const equal = vi.fn();
    renderNav(layout, [{ id: 'equal', label: 'Equally', icon, onSelect: equal, loading: true }]);
    const slot = screen.getByTestId('section-nav-dest-equal');
    expect(slot).toHaveAttribute('aria-busy', 'true');
    expect(slot).toHaveAttribute('aria-disabled', 'true');
    expect(slot).not.toBeDisabled();
    expect(within(slot).getByTestId('section-nav-spinner')).toBeInTheDocument();
    await focusOn(slot);
    await waitFor(() => expect(slot).toHaveFocus());
    fireEvent.click(slot);
    expect(equal).not.toHaveBeenCalled();
    await waitFor(() => expect(slot).toHaveFocus());
  });

  it('keeps a loading action primary focusable, busy and refusing the tap', async () => {
    const pay = vi.fn();
    const primary: SectionNavAction = { label: 'Pay all', icon, onSelect: pay, loading: true };
    renderNav(layout, [], { primary });
    const button = screen.getByTestId('section-nav-primary');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(within(button).getByTestId('section-nav-spinner')).toBeInTheDocument();
    await focusOn(button);
    await waitFor(() => expect(button).toHaveFocus());
    fireEvent.click(button);
    expect(pay).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toHaveFocus());
  });
});

describe('SectionNav bar: primary and sheet gaps', () => {
  it('names the captioned primary exactly once', () => {
    renderNav('bar', [], { primary: { label: 'Pay all', icon, onSelect: vi.fn() } });
    expect(screen.getAllByRole('button', { name: 'Pay all' })).toHaveLength(1);
  });

  it('keeps a disabled primary MENU shut', async () => {
    renderNav('bar', [], { primary: menu({ disabled: true }) });
    const trigger = screen.getByTestId('section-nav-primary');
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does not run a disabled sheet entry', () => {
    const print = vi.fn();
    const more: SectionNavMenu = {
      label: 'More',
      icon,
      title: 'More options',
      groups: [{ id: 'rest', entries: [{ id: 'print', label: 'Print', icon, onSelect: print, disabled: true }] }],
    };
    renderNav('bar', [], { more });
    fireEvent.click(screen.getByTestId('section-nav-more'));
    const entry = screen.getByTestId('section-nav-more-sheet-entry-print');
    expect(entry).toBeDisabled();
    fireEvent.click(entry);
    expect(print).not.toHaveBeenCalled();
  });
});

describe('SectionNav rail: a disabled menu', () => {
  it('draws a disabled primary menu as a disabled button that opens nothing', () => {
    renderNav('rail', [], { primary: menu({ disabled: true }) });
    const button = screen.getByTestId('section-nav-primary');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByTestId('section-nav-primary-menu')).toBeNull();
  });

  it('makes every row of a disabled more menu inert', () => {
    const onSelect = vi.fn();
    renderNav('rail', [], { more: menu({ disabled: true }, onSelect) });
    const delivery = screen.getByTestId('section-nav-more-entry-delivery');
    const queue = screen.getByTestId('section-nav-more-entry-queue');
    expect(delivery).toBeDisabled();
    expect(queue).toBeDisabled();
    expect(queue).not.toHaveAttribute('href');
    fireEvent.click(delivery);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves the rows of a live menu live', () => {
    renderNav('rail', [], { more: menu() });
    expect(screen.getByTestId('section-nav-more-entry-delivery')).toBeEnabled();
    expect(screen.getByTestId('section-nav-more-entry-queue')).toHaveAttribute('href', '/queue');
  });
});
