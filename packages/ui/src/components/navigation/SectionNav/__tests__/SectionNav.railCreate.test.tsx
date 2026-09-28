/**
 * The rail's `primary` menu as one button that opens it (FUT-3015): a create
 * menu listed in full cost a heading and a two-line row per entry, so the rail
 * folds it behind '+ Create' at the top and opens it as an anchored menu.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_SECTION_NAV_COPY } from '../../../../en-US.navigation';
import { SectionNav } from '../SectionNav';
import type {
  SectionNavDestination,
  SectionNavMenu,
} from '../SectionNav.types';

afterEach(cleanup);

const icon = <svg data-testid="icon" />;

const DESTINATIONS: SectionNavDestination[] = [
  { id: 'products', label: 'Products', icon, href: '/products' },
];

const HostLink = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement>
>(function HostLink({ href, ...rest }, ref) {
  // jsdom cannot navigate; the router a host passes would not reload either.
  return (
    <a
      ref={ref}
      data-host-link={href}
      href={href}
      onClickCapture={(event) => event.preventDefault()}
      {...rest}
    />
  );
});

function create(
  onPause = vi.fn(),
  overrides: Partial<SectionNavMenu> = {},
): SectionNavMenu {
  return {
    label: 'Create',
    icon,
    title: 'Create now',
    groups: [
      {
        id: 'catalog',
        title: 'Catalog',
        layout: 'grid',
        entries: [
          {
            id: 'product',
            label: 'New product',
            description: 'Something new to sell',
            icon,
            href: '/products?criar=produto',
          },
          {
            id: 'pause',
            label: 'Pause a product',
            icon,
            onSelect: onPause,
            badge: 2,
          },
        ],
      },
      {
        id: 'stock',
        title: 'Stock',
        entries: [
          {
            id: 'supplier',
            label: 'New supplier',
            icon,
            href: '/suppliers',
            disabled: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function renderRail(primary: SectionNavMenu): void {
  render(
    <SectionNav
      layout="rail"
      label="Catalog"
      heading="Catalog and stock"
      back={{ label: 'Back', href: '/home', icon }}
      destinations={DESTINATIONS}
      primary={primary}
      more={{
        label: 'More',
        icon,
        title: 'More',
        groups: [
          {
            id: 'rest',
            entries: [{ id: 'queue', label: 'Queue', icon, href: '/queue' }],
          },
        ],
      }}
      linkComponent={HostLink}
      copy={EN_US_SECTION_NAV_COPY}
    />,
  );
}

function open(): HTMLElement {
  fireEvent.click(screen.getByTestId('section-nav-primary'));
  return screen.getByTestId('section-nav-primary-menu');
}

describe('SectionNav rail: the create menu behind one button', () => {
  it('draws one button under the heading, above the destinations, and none of its entries', () => {
    renderRail(create());
    const button = screen.getByTestId('section-nav-primary');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveTextContent('Create');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // It sits before the first destination in the rail's order.
    const destination = screen.getByTestId('section-nav-dest-products');
    expect(
      button.compareDocumentPosition(destination) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText('Create now')).toBeNull();
    expect(
      screen.queryByTestId('section-nav-primary-entry-product'),
    ).toBeNull();
    // More is still listed.
    expect(screen.getByTestId('section-nav-more-entry-queue')).toHaveAttribute(
      'href',
      '/queue',
    );
  });

  it('opens a menu named by the title, with each group title and every entry and hint', () => {
    renderRail(create());
    const menu = open();
    expect(screen.getByTestId('section-nav-primary')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(
      screen.getByRole('menu', { name: 'Create now' }),
    ).toBeInTheDocument();
    expect(within(menu).getByText('Catalog')).toBeInTheDocument();
    expect(within(menu).getByText('Stock')).toBeInTheDocument();
    expect(within(menu).getByText('Something new to sell')).toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(3);
    expect(within(menu).getByLabelText('2 pending')).toBeInTheDocument();
  });

  it('renders a link entry through the host link, and closes when it is chosen', async () => {
    renderRail(create());
    open();
    const product = screen.getByTestId('section-nav-primary-entry-product');
    expect(product).toHaveAttribute(
      'data-host-link',
      '/products?criar=produto',
    );
    fireEvent.click(product);
    await waitFor(() =>
      expect(
        screen.queryByTestId('section-nav-primary-entry-product'),
      ).toBeNull(),
    );
  });

  it('runs an acting entry and closes', async () => {
    const onPause = vi.fn();
    renderRail(create(onPause));
    open();
    fireEvent.click(screen.getByTestId('section-nav-primary-entry-pause'));
    expect(onPause).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.queryByTestId('section-nav-primary-entry-pause'),
      ).toBeNull(),
    );
  });

  it('refuses a disabled entry and does not link it', () => {
    renderRail(create());
    open();
    const supplier = screen.getByTestId('section-nav-primary-entry-supplier');
    expect(supplier).toHaveAttribute('aria-disabled', 'true');
    expect(supplier).not.toHaveAttribute('href');
  });

  it('closes on Escape and hands focus back to the button', async () => {
    renderRail(create());
    const button = screen.getByTestId('section-nav-primary');
    button.focus();
    const menu = open();
    fireEvent.keyDown(within(menu).getByRole('menu'), { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.queryByTestId('section-nav-primary-entry-pause'),
      ).toBeNull(),
    );
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("takes the menu's own test id when the host gives one", () => {
    renderRail(create(vi.fn(), { dataTestId: 'catalog-create' }));
    expect(screen.getByTestId('catalog-create')).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
  });
});
