/**
 * `{item.badge && <Box>…</Box>}` renders a bare `0` text node next to the
 * label when `badge` is the number `0`, because `0 && …` evaluates to `0` and
 * React prints a number child as text. The stray `0` sits outside the badge
 * pill, so it is unstyled and folds into the link's accessible name
 * ("Pedidos0").
 *
 * The fix treats a zero count the way the package's own `Badge` treats it:
 * hidden by default (`Badge.helpers.ts`'s `showZero: false`). A caller who
 * wants a visible zero passes the string `'0'`, which is truthy and renders
 * the pill.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NavigationMenu } from '../NavigationMenu';
import type { NavigationMenuItem } from '../NavigationMenu.types';

const items: NavigationMenuItem[] = [
  { id: 'zero-number', label: 'Pedidos', href: '#zero-number', badge: 0 },
  { id: 'zero-string', label: 'Mensagens', href: '#zero-string', badge: '0' },
  { id: 'five', label: 'Alertas', href: '#five', badge: 5 },
  { id: 'new', label: 'Promoções', href: '#new', badge: 'NEW' },
  { id: 'none', label: 'Configurações', href: '#none' },
];

describe('NavigationMenuItem badge', () => {
  it('never renders a bare "0" text node for a numeric zero badge', () => {
    render(<NavigationMenu variant="vertical" items={items} />);

    const zeroNumberLink = screen.getByRole('link', { name: 'Pedidos' });
    expect(zeroNumberLink.textContent).not.toMatch(/0/);
    expect(zeroNumberLink).not.toHaveTextContent('0');
  });

  it('hides the pill for a numeric zero badge', () => {
    render(<NavigationMenu variant="vertical" items={items} />);

    const zeroNumberLink = screen.getByRole('link', { name: 'Pedidos' });
    expect(within(zeroNumberLink).queryByTestId('navigation-menu-badge-zero-number')).not.toBeInTheDocument();
  });

  it('shows the pill for the string "0"', () => {
    render(<NavigationMenu variant="vertical" items={items} />);

    expect(screen.getByTestId('navigation-menu-badge-zero-string')).toHaveTextContent('0');
  });

  it('shows the pill for a positive number and for a string label', () => {
    render(<NavigationMenu variant="vertical" items={items} />);

    expect(screen.getByTestId('navigation-menu-badge-five')).toHaveTextContent('5');
    expect(screen.getByTestId('navigation-menu-badge-new')).toHaveTextContent('NEW');
  });

  it('renders no badge pill at all when the item has none', () => {
    render(<NavigationMenu variant="vertical" items={items} />);

    expect(screen.queryByTestId('navigation-menu-badge-none')).not.toBeInTheDocument();
  });
});
