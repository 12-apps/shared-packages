/**
 * A HOST DECIDES WHETHER A SCROLLABLE STRIP HAS SCROLL BUTTONS (FUT-4408).
 *
 * `Tabs` used to map every `scrollButtons` value to MUI's `'auto'` and force
 * `allowScrollButtonsMobile`, so every scrollable strip that overflowed got the
 * in-flow 40 px ‹ › boxes, phones included, and no host could switch them off.
 * The storefront's category band needs none (it overlays its own arrows).
 *
 * jsdom has no layout, so MUI learns that the row overflows the way it does in
 * a browser: from the `IntersectionObserver` it puts on the first and last tab.
 * The stub below reports the first tab in view and the last one out of it — a
 * strip at its start with more to the right.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tabs } from './Tabs';
import type { TabsProps } from './Tabs.types';

class OverflowingRowObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    const isLastTab = target.nextElementSibling === null;
    this.callback(
      [{ target, isIntersecting: !isLastTab } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  unobserve(): void {}

  disconnect(): void {}
}

const ITEMS = Array.from({ length: 14 }, (_, i) => ({
  id: `category-${i}`,
  label: `Category ${i + 1}`,
  content: <p>category {i + 1}</p>,
}));

function renderStrip(props: Partial<TabsProps> = {}): void {
  render(
    <Tabs
      closeTabLabel="Fechar"
      value="category-0"
      onChange={() => undefined}
      items={ITEMS}
      scrollable
      {...props}
    />,
  );
}

const scrollButtons = (): Element[] =>
  Array.from(screen.getByTestId('tabs-list').querySelectorAll('.MuiTabs-scrollButtons'));

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', OverflowingRowObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Tabs scroll buttons', () => {
  it('renders both buttons on an overflowing scrollable strip when the prop is omitted, as before', () => {
    renderStrip();
    const buttons = scrollButtons();
    expect(buttons).toHaveLength(2);
    const [left, right] = buttons;
    // At the start, ‹ carries MUI's disabled class and › is live.
    expect(left).toHaveClass('Mui-disabled');
    expect(right).not.toHaveClass('Mui-disabled');
    // Shown on phones too, as before: MUI's hide-below-sm class is absent.
    expect(right).not.toHaveClass('MuiTabs-scrollButtonsHideMobile');
  });

  it('renders no scroll buttons at all with scrollButtons={false}', () => {
    renderStrip({ scrollButtons: false });
    expect(scrollButtons()).toHaveLength(0);
    // The strip still scrolls: every tab is there.
    expect(screen.getAllByRole('tab')).toHaveLength(ITEMS.length);
  });

  it('renders the buttons even when the row fits with scrollButtons={true}', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    renderStrip({ scrollButtons: true });
    expect(scrollButtons()).toHaveLength(2);
  });

  it('keeps the deprecated strings behaving as auto, as before', () => {
    renderStrip({ scrollButtons: 'off' });
    expect(scrollButtons()).toHaveLength(2);
  });

  it('honours allowScrollButtonsMobile={false}', () => {
    renderStrip({ allowScrollButtonsMobile: false });
    const buttons = scrollButtons();
    expect(buttons).toHaveLength(2);
    const [, right] = buttons;
    expect(right).toHaveClass('MuiTabs-scrollButtonsHideMobile');
  });

  it('renders no buttons on a strip that does not scroll, whatever the prop says', () => {
    renderStrip({ scrollable: false, scrollButtons: true });
    expect(scrollButtons()).toHaveLength(0);
  });
});
