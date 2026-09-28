/**
 * `SectionNav` as a bar of VERBS — action slots, a raised primary that acts on
 * tap, disabled and in-flight states, and host-owned test ids.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_SECTION_NAV_COPY } from '../../../../en-US.navigation';
import { SectionNav } from '../SectionNav';
import { isMenu } from '../SectionNav.helpers';
import type { SectionNavAction, SectionNavDestination, SectionNavMenu } from '../SectionNav.types';

afterEach(cleanup);

const icon = <svg data-testid="icon" />;

function actions(handlers: { split?: () => void; equal?: () => void } = {}): SectionNavDestination[] {
  return [
    { id: 'split', label: 'Split', icon, onSelect: handlers.split ?? vi.fn(), dataTestId: 'bar-split' },
    { id: 'equal', label: 'Equally', icon, onSelect: handlers.equal ?? vi.fn(), dataTestId: 'bar-equal' },
  ];
}

const MORE: SectionNavMenu = {
  label: 'More',
  icon,
  title: 'More options',
  dataTestId: 'bar-more',
  groups: [
    {
      id: 'rest',
      entries: [
        { id: 'print', label: 'Print', icon, onSelect: vi.fn(), disabled: true, dataTestId: 'bar-print' },
        { id: 'coupon', label: 'Coupon', icon, onSelect: vi.fn(), dataTestId: 'bar-coupon' },
      ],
    },
  ],
};

function renderBar(
  destinations: SectionNavDestination[],
  primary?: SectionNavAction | SectionNavMenu,
  more?: SectionNavMenu,
): void {
  render(
    <SectionNav
      layout="bar"
      label="Close"
      destinations={destinations}
      primary={primary}
      more={more}
      copy={EN_US_SECTION_NAV_COPY}
    />,
  );
}

describe('SectionNav action slots', () => {
  it('tells a menu primary from an action primary', () => {
    expect(isMenu(MORE)).toBe(true);
    expect(isMenu({ label: 'Pay', icon, onSelect: vi.fn() })).toBe(false);
    expect(isMenu(undefined)).toBe(false);
  });

  it('draws an action slot as a button under the host id, and runs it', () => {
    const split = vi.fn();
    renderBar(actions({ split }));
    const slot = screen.getByTestId('bar-split');
    expect(slot.tagName).toBe('BUTTON');
    expect(slot).not.toHaveAttribute('href');
    fireEvent.click(slot);
    expect(split).toHaveBeenCalledTimes(1);
  });

  it('refuses a disabled slot and a slot whose write is in flight', () => {
    const split = vi.fn();
    const equal = vi.fn();
    const [first, second] = actions({ split, equal });
    renderBar([
      { ...first!, disabled: true },
      { ...second!, loading: true },
    ]);
    expect(screen.getByTestId('bar-split')).toBeDisabled();
    const busy = screen.getByTestId('bar-equal');
    // In flight stays focusable: aria-disabled, never native disabled.
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy).getByTestId('section-nav-spinner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bar-split'));
    fireEvent.click(busy);
    expect(split).not.toHaveBeenCalled();
    expect(equal).not.toHaveBeenCalled();
  });

  it('never lets a disabled LINK navigate', () => {
    renderBar([{ id: 'floor', label: 'Floor', icon, href: '/floor', disabled: true }]);
    const slot = screen.getByTestId('section-nav-dest-floor');
    expect(slot.tagName).toBe('BUTTON');
    expect(slot).not.toHaveAttribute('href');
    expect(slot).toBeDisabled();
  });

  it('draws an action primary raised in the middle, with its label visible, and acts on tap', async () => {
    const pay = vi.fn();
    renderBar(actions(), { label: 'Pay all', icon, onSelect: pay, dataTestId: 'bar-pay' });
    const button = screen.getByTestId('bar-pay');
    expect(button).toHaveAttribute('aria-label', 'Pay all');
    expect(button).not.toHaveAttribute('aria-expanded');
    expect(screen.getByText('Pay all')).toBeInTheDocument();
    fireEvent.click(button);
    expect(pay).toHaveBeenCalledTimes(1);
    // An action opens no sheet.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses a disabled action primary', () => {
    const pay = vi.fn();
    renderBar(actions(), { label: 'Pay all', icon, onSelect: pay, disabled: true, dataTestId: 'bar-pay' });
    expect(screen.getByTestId('bar-pay')).toBeDisabled();
    fireEvent.click(screen.getByTestId('bar-pay'));
    expect(pay).not.toHaveBeenCalled();
  });

  it('opens the more sheet under the host ids, with a disabled entry refused', () => {
    renderBar(actions(), undefined, MORE);
    fireEvent.click(screen.getByTestId('bar-more'));
    expect(screen.getByRole('dialog', { name: 'More options' })).toBeInTheDocument();
    expect(screen.getByTestId('bar-print')).toBeDisabled();
    expect(screen.getByTestId('bar-coupon')).toBeEnabled();
  });

  it('does not open a disabled more', async () => {
    renderBar(actions(), undefined, { ...MORE, disabled: true });
    const trigger = screen.getByTestId('bar-more');
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('SectionNav rail with actions', () => {
  it('lists an action primary as one row and honours disabled slots', () => {
    const pay = vi.fn();
    const [first] = actions();
    render(
      <SectionNav
        layout="rail"
        label="Close"
        destinations={[{ ...first!, disabled: true }]}
        primary={{ label: 'Pay all', icon, onSelect: pay }}
        copy={EN_US_SECTION_NAV_COPY}
      />,
    );
    expect(screen.getByTestId('bar-split')).toBeDisabled();
    fireEvent.click(screen.getByTestId('section-nav-primary'));
    expect(pay).toHaveBeenCalledTimes(1);
  });
});
