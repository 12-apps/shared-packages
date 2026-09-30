/**
 * `SectionNav` — a section's own navigation, as a phone bar with a raised
 * primary action and sheets, or as a wide-screen rail.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_SECTION_NAV_COPY } from '../../../../en-US.navigation';
import { SectionNav } from '../SectionNav';
import { barSlots, menuActive, menuCount, shownCount } from '../SectionNav.helpers';
import { RaisedActionButton } from '../SectionNav.primary';
import type { SectionNavDestination, SectionNavMenu } from '../SectionNav.types';

afterEach(cleanup);

const icon = <svg data-testid="icon" />;

const DESTINATIONS: SectionNavDestination[] = [
  { id: 'floor', label: 'Floor', icon, href: '/floor', active: true },
  { id: 'board', label: 'Board', icon, href: '/board', badge: 3 },
  { id: 'serve', label: 'Serve', icon, href: '/serve', badge: 0 },
];

function menus(onCreate = vi.fn()): { primary: SectionNavMenu; more: SectionNavMenu } {
  return {
    primary: {
      label: 'Create',
      icon,
      title: 'Create now',
      groups: [
        {
          id: 'order',
          title: 'New order',
          layout: 'grid',
          entries: [{ id: 'delivery', label: 'Delivery', icon, onSelect: onCreate }],
        },
      ],
    },
    more: {
      label: 'More',
      icon,
      title: 'More',
      groups: [
        {
          id: 'rest',
          layout: 'grid',
          entries: [
            { id: 'queue', label: 'Queue', icon, href: '/queue', badge: 2 },
            { id: 'runs', label: 'Runs', icon, href: '/runs', badge: 1 },
          ],
        },
      ],
    },
  };
}

describe('SectionNav helpers', () => {
  it('draws only positive, finite counts', () => {
    expect(shownCount(undefined)).toBeUndefined();
    expect(shownCount(0)).toBeUndefined();
    expect(shownCount(-1)).toBeUndefined();
    expect(shownCount(Number.NaN)).toBeUndefined();
    expect(shownCount(4)).toBe(4);
  });

  it('rolls a menu up into one count, and reads it as current when an entry is', () => {
    const { more } = menus();
    expect(menuCount(more)).toBe(3);
    expect(menuCount(undefined)).toBeUndefined();
    expect(menuActive(more)).toBe(false);
    const current: SectionNavMenu = {
      ...more,
      groups: [{ id: 'g', entries: [{ id: 'queue', label: 'Queue', icon, href: '/q', active: true }] }],
    };
    expect(menuActive(current)).toBe(true);
  });

  it('puts the primary in the middle of the slots, more last', () => {
    const kinds = barSlots(DESTINATIONS, true, true).map((slot) =>
      slot.kind === 'destination' ? slot.destination.id : slot.kind,
    );
    expect(kinds).toEqual(['floor', 'board', 'primary', 'serve', 'more']);
    expect(barSlots(DESTINATIONS, false, false)).toHaveLength(3);
  });
});

describe('SectionNav bar', () => {
  it('renders a labelled landmark with every destination as a link', () => {
    render(<SectionNav layout="bar" label="Operations" destinations={DESTINATIONS} copy={EN_US_SECTION_NAV_COPY} />);
    const nav = screen.getByRole('navigation', { name: 'Operations' });
    const floor = within(nav).getByTestId('section-nav-dest-floor');
    expect(floor).toHaveAttribute('href', '/floor');
    expect(floor).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByTestId('section-nav-dest-board')).not.toHaveAttribute('aria-current');
  });

  it('draws a count only where one is waiting, named for assistive tech', () => {
    render(<SectionNav layout="bar" label="Operations" destinations={DESTINATIONS} copy={EN_US_SECTION_NAV_COPY} />);
    expect(screen.getByTestId('section-nav-dest-board-badge')).toBeInTheDocument();
    expect(screen.getByLabelText('3 pending')).toBeInTheDocument();
    // Only the one destination with something waiting carries a count.
    expect(screen.getAllByLabelText(/pending$/)).toHaveLength(1);
  });

  it('opens the primary sheet, flips its name to close, and runs an action then closes', () => {
    const onCreate = vi.fn();
    const { primary, more } = menus(onCreate);
    render(
      <SectionNav
        layout="bar"
        label="Operations"
        destinations={DESTINATIONS}
        primary={primary}
        more={more}
        copy={EN_US_SECTION_NAV_COPY}
      />,
    );
    const button = screen.getByTestId('section-nav-primary');
    expect(button).toHaveAttribute('aria-label', 'Create');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-label', 'Close');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Create now')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('section-nav-primary-sheet-entry-delivery'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('rolls the more entries up onto its slot, and lists them as links in its sheet', () => {
    const { more } = menus();
    render(
      <SectionNav layout="bar" label="Operations" destinations={DESTINATIONS} more={more} copy={EN_US_SECTION_NAV_COPY} />,
    );
    expect(within(screen.getByTestId('section-nav-more')).getByLabelText('3 pending')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('section-nav-more'));
    expect(screen.getByTestId('section-nav-more')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('section-nav-more-sheet-entry-queue')).toHaveAttribute('href', '/queue');
  });

  it('opens each sheet as a modal dialog named by its title, which Escape closes', () => {
    const { primary, more } = menus();
    render(
      <SectionNav
        layout="bar"
        label="Operations"
        destinations={DESTINATIONS}
        primary={primary}
        more={more}
        copy={EN_US_SECTION_NAV_COPY}
      />,
    );
    fireEvent.click(screen.getByTestId('section-nav-primary'));
    const dialog = screen.getByRole('dialog', { name: 'Create now' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByTestId('section-nav-primary')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByTestId('section-nav-more'));
    expect(screen.getByRole('dialog', { name: 'More' })).toHaveAttribute('aria-modal', 'true');
  });

  it('keeps aria-current on the page the viewer is on while a sheet is open', () => {
    const { more } = menus();
    render(
      <SectionNav layout="bar" label="Operations" destinations={DESTINATIONS} more={more} copy={EN_US_SECTION_NAV_COPY} />,
    );
    const floor = screen.getByTestId('section-nav-dest-floor');
    const moreSlot = screen.getByTestId('section-nav-more');
    expect(floor).toHaveAttribute('data-lit', 'true');

    fireEvent.click(moreSlot);
    // Only the look moves to the open slot; the page the viewer is on does not.
    expect(floor).toHaveAttribute('aria-current', 'page');
    expect(floor).not.toHaveAttribute('data-lit');
    expect(moreSlot).toHaveAttribute('data-lit', 'true');
    expect(moreSlot).not.toHaveAttribute('aria-current');
  });

  it('renders links through the host link component', () => {
    const HostLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(function HostLink(
      { href, ...rest },
      ref,
    ) {
      return <a ref={ref} data-host-link={href} href={href} {...rest} />;
    });
    render(
      <SectionNav
        layout="bar"
        label="Operations"
        destinations={DESTINATIONS}
        linkComponent={HostLink}
        copy={EN_US_SECTION_NAV_COPY}
      />,
    );
    expect(screen.getByTestId('section-nav-dest-board')).toHaveAttribute('data-host-link', '/board');
  });
});

describe('SectionNav rail', () => {
  it('draws the way back, the heading, the destinations and every menu listed', () => {
    const { primary, more } = menus();
    render(
      <SectionNav
        layout="rail"
        label="Operations"
        heading="Operations"
        back={{ label: 'Back', href: '/home', icon }}
        destinations={DESTINATIONS}
        primary={primary}
        more={more}
        copy={EN_US_SECTION_NAV_COPY}
      />,
    );
    expect(screen.getByTestId('section-nav-back')).toHaveAttribute('href', '/home');
    expect(screen.getByTestId('section-nav-dest-floor')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('section-nav-more-entry-queue')).toHaveAttribute('href', '/queue');
    // More is listed; the create menu is folded behind one button (FUT-3015).
    expect(screen.getByTestId('section-nav-more').tagName).toBe('SECTION');
    expect(screen.getByTestId('section-nav-primary')).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByTestId('section-nav')).not.toHaveTextContent('Delivery');
  });
});

describe('RaisedActionButton', () => {
  it('is a plain action when it opens nothing', () => {
    const onClick = vi.fn();
    render(<RaisedActionButton label="Add" icon={icon} onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Add' });
    expect(button).not.toHaveAttribute('aria-expanded');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('takes its close name while what it opened is open', () => {
    render(<RaisedActionButton label="Add" icon={icon} onClick={() => undefined} open closeLabel="Close" />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
  });
});
