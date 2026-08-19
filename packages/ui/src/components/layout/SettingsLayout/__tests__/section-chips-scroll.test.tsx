/**
 * THE STRIP MUST NOT TAKE THE PAGE DOWN TO CENTRE A CHIP.
 *
 * `SettingsSectionChips` scrolls itself to the open section in an effect. It did
 * that by calling `strip.scrollTo(...)` unconditionally — and `Element.scrollTo`
 * does not exist in jsdom, nor in a few embedded webviews.
 *
 * An exception thrown from an effect is not contained: React escalates it to the
 * nearest error boundary, so the whole settings area went down. In the host that
 * meant `Configuração` rendering a crash screen, and every one of that host's
 * own tests failing to render the shell at all — a component that cannot be
 * mounted in jsdom is a component nobody downstream can test around.
 *
 * These cases run in jsdom precisely BECAUSE it lacks `scrollTo`: the
 * environment is the reproduction. The first one fails outright without the
 * guard; the second proves the guard did not simply disable the behaviour where
 * the API does exist.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsSectionChips } from '../SettingsSectionChips';
import type { SettingsNavItem } from '../SettingsLayout.types';

const ITEMS: SettingsNavItem[] = [
  { id: 'branding', label: 'Perfil e marca', href: '#/config/branding' },
  { id: 'location', label: 'Endereço', href: '#/config/location' },
  { id: 'hours', label: 'Horários', href: '#/config/hours' },
];

function renderStrip(activeItemId: string): void {
  render(
    <SettingsSectionChips
      items={ITEMS}
      activeItemId={activeItemId}
      ariaLabel="Configuração"
      linkComponent="a"
      testIdPrefix="settings"
    />,
  );
}

describe('SettingsSectionChips in an environment without Element.scrollTo', () => {
  it('renders every chip instead of throwing out of the effect', () => {
    // The precondition this test exists for. If jsdom ever gains `scrollTo`,
    // this assertion fails and says so, rather than the case quietly becoming
    // a test of nothing.
    expect(typeof Element.prototype.scrollTo).not.toBe('function');

    renderStrip('hours');

    expect(screen.getByTestId('settings-chips')).toBeInTheDocument();
    for (const item of ITEMS) {
      expect(screen.getByTestId(`settings-chip-${item.id}`)).toBeInTheDocument();
    }
    // The open one is still announced, so the guard costs no meaning.
    expect(screen.getByTestId('settings-chip-hours')).toHaveAttribute('aria-current', 'page');
  });

  it('still scrolls itself when the platform does provide scrollTo', () => {
    const scrollTo = vi.fn();
    // Defined on the prototype rather than on one node: the component reaches
    // the element through its own ref, which no test can hand it directly.
    Object.defineProperty(Element.prototype, 'scrollTo', {
      value: scrollTo,
      configurable: true,
      writable: true,
    });

    try {
      renderStrip('hours');
      expect(scrollTo).toHaveBeenCalled();
    } finally {
      // Put the environment back, so the case above keeps meaning what it says
      // whatever order the two run in.
      delete (Element.prototype as unknown as Record<string, unknown>).scrollTo;
    }
  });
});
