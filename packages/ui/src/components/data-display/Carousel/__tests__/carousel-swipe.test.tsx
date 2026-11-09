import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

import { createTheme } from '@mui/material/styles/index.js';

import { Carousel } from '../Carousel';
import { rem } from '../../../../tokens/scales';
import { PT_BR_CAROUSEL_COPY } from '../../../../pt-BR';

afterEach(cleanup);

const makeItems = () => ['a', 'b', 'c', 'd'].map((id) => ({ id, content: id.toUpperCase() }));
const active = () =>
  makeItems().findIndex((_, i) => screen.getByTestId(`carousel-slide-${i}`).getAttribute('data-active') === 'true');

/** jsdom has no PointerEvent: a MouseEvent under the pointer name carries the same coordinates. */
const pointer = (
  el: Element,
  type: string,
  x: number,
  y: number,
  timeStamp?: number,
  extra: { pointerId?: number; isPrimary?: boolean; pointerType?: string } = {},
) => {
  const event = new MouseEvent(type.toLowerCase(), {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, { value });
  fireEvent(el, event);
};

const drag = (from: [number, number], to: [number, number], ms = 300) => {
  const frame = screen.getByTestId('carousel-container');
  pointer(frame, 'pointerDown', from[0], from[1], 1000);
  pointer(frame, 'pointerMove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 1000 + ms / 2);
  pointer(frame, 'pointerMove', to[0], to[1], 1000 + ms);
  pointer(frame, 'pointerUp', to[0], to[1], 1000 + ms);
};

const mount = (props: Partial<React.ComponentProps<typeof Carousel>> = {}) =>
  render(<Carousel items={makeItems()} copy={PT_BR_CAROUSEL_COPY} {...props} />);

describe('Carousel swipe', () => {
  it('goes to the next slide on a leftward drag and back on a rightward one', () => {
    mount();
    drag([300, 100], [100, 100]);
    expect(active()).toBe(1);
    drag([100, 100], [300, 100]);
    expect(active()).toBe(0);
  });

  it('takes a short fast fling', () => {
    mount();
    drag([200, 100], [160, 100], 40);
    expect(active()).toBe(1);
  });

  it('ignores a short slow drag', () => {
    mount();
    drag([200, 100], [170, 100], 600);
    expect(active()).toBe(0);
  });

  it('leaves a mostly vertical move to the page', () => {
    mount();
    drag([200, 100], [150, 400]);
    expect(active()).toBe(0);
  });

  it('keeps the page panning vertically', () => {
    mount();
    const frame = screen.getByTestId('carousel-container');
    const rules = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('');
    expect(rules).toContain('touch-action:pan-y');
    expect(rules).toContain(frame.className.split(' ').find((c) => c.startsWith('css-')) ?? '#');
  });

  it('does not report a swipe as a tap, and does report a tap', () => {
    const onClick = vi.fn();
    mount({ onClick });
    const slide = screen.getByText('A');

    drag([300, 100], [100, 100]);
    fireEvent.click(screen.getByText('B'));
    expect(onClick).not.toHaveBeenCalled();

    // The next gesture is a plain tap on the now-visible slide.
    const frame = screen.getByTestId('carousel-container');
    pointer(frame, 'pointerDown', 50, 50, 5000);
    pointer(frame, 'pointerUp', 50, 50, 5080);
    fireEvent.click(screen.getByText('B'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[1]).toBe(1);
    expect(slide).toBeTruthy();
  });

  it('does nothing with a single item', () => {
    mount({ items: makeItems().slice(0, 1) });
    drag([300, 100], [100, 100]);
    expect(active()).toBe(0);
  });
});

describe('Carousel keyboard', () => {
  it('moves with the arrow keys while focused, and not from outside', () => {
    mount();
    const frame = screen.getByRole('region');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(active()).toBe(0);
    fireEvent.keyDown(frame, { key: 'ArrowRight' });
    expect(active()).toBe(1);
    fireEvent.keyDown(screen.getByTestId('carousel-next-button'), { key: 'ArrowLeft' });
    expect(active()).toBe(0);
  });
});

describe('Carousel start index, counter and a11y', () => {
  it('opens on startIndex, clamped', () => {
    mount({ startIndex: 2 });
    expect(active()).toBe(2);
    cleanup();
    mount({ startIndex: 99 });
    expect(active()).toBe(3);
  });

  it('draws the caller-worded counter in step with the dots', () => {
    mount({ showCounter: true, startIndex: 1 });
    expect(screen.getByTestId('carousel-counter')).toHaveTextContent('2 de 4');
    fireEvent.click(screen.getByTestId('carousel-next-button'));
    expect(screen.getByTestId('carousel-counter')).toHaveTextContent('3 de 4');
    expect(screen.getByTestId('carousel-indicator-2')).toHaveAttribute('data-active', 'true');
  });

  it('draws the counter from copy.position, not from the package', () => {
    mount({ showCounter: true, copy: { ...PT_BR_CAROUSEL_COPY, position: (n, m) => `foto ${n}/${m}` } });
    expect(screen.getByTestId('carousel-counter')).toHaveTextContent('foto 1/4');
  });

  it('hides the counter unless asked', () => {
    mount();
    expect(screen.queryAllByTestId('carousel-counter')).toHaveLength(0);
  });

  it('hides every control for a single item', () => {
    mount({ items: makeItems().slice(0, 1), showCounter: true });
    for (const id of ['carousel-navigation', 'carousel-indicators', 'carousel-counter']) {
      expect(screen.queryAllByTestId(id)).toHaveLength(0);
    }
  });

  it('names the region, the slides and the arrows from the caller copy', () => {
    mount();
    expect(screen.getByRole('region', { name: 'Carrossel' })).toHaveAttribute(
      'aria-roledescription',
      'carrossel',
    );
    expect(screen.getByTestId('carousel-slide-0')).toHaveAttribute('aria-roledescription', 'slide');
    expect(screen.getByTestId('carousel-slide-0')).toHaveAttribute('aria-label', 'Slide 1 de 4');
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeTruthy();
  });
});

describe('Carousel indicators below the photo', () => {
  it('draws the dot row after the frame, outside it, and keeps it in step', () => {
    mount({ indicatorPosition: 'below', indicatorVariant: 'pills' });
    const row = screen.getByTestId('carousel-indicators');

    expect(screen.getByTestId('carousel-container').contains(row)).toBe(false);
    expect(screen.getByTestId('carousel-container').parentElement).toBe(row.parentElement);
    expect(screen.getByTestId('carousel-container').nextElementSibling).toBe(row);

    fireEvent.click(screen.getByTestId('carousel-next-button'));
    expect(screen.getByTestId('carousel-indicator-1')).toHaveAttribute('data-active', 'true');
  });

  it('keeps every other position inside the frame', () => {
    mount({ indicatorPosition: 'bottom' });
    expect(
      screen.getByTestId('carousel-container').contains(screen.getByTestId('carousel-indicators')),
    ).toBe(true);
  });

  it('draws no row below for a single item', () => {
    mount({ items: makeItems().slice(0, 1), indicatorPosition: 'below' });
    expect(screen.queryAllByTestId('carousel-indicators')).toHaveLength(0);
  });
});

/** The element's own Emotion class, so a rule is read for it and not for a leftover from another test. */
const ownClass = (el: Element): string => {
  const own = Array.from(el.classList).find((name) => name.startsWith('css-'));
  if (!own) throw new Error('no Emotion class on the element');
  return own;
};

const cssText = () =>
  Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('');

describe('Carousel review round 1', () => {
  it('keeps the start index through a list that is still loading', () => {
    const { rerender } = mount({ items: makeItems().slice(0, 1), startIndex: 2 });
    rerender(<Carousel items={makeItems()} copy={PT_BR_CAROUSEL_COPY} startIndex={2} />);
    expect(active()).toBe(2);
  });

  it('steps from what is shown after the list shrinks', () => {
    const { rerender } = mount({ startIndex: 3 });
    rerender(<Carousel items={makeItems().slice(0, 2)} copy={PT_BR_CAROUSEL_COPY} startIndex={3} />);
    fireEvent.click(screen.getByTestId('carousel-prev-button'));
    expect(active()).toBe(0);
  });

  it('taps the active slide with Enter and with Space on the focused frame', () => {
    const onClick = vi.fn();
    mount({ onClick, startIndex: 1 });
    const frame = screen.getByRole('region');
    fireEvent.keyDown(frame, { key: 'Enter' });
    fireEvent.keyDown(frame, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onClick.mock.calls[1]?.[1]).toBe(1);
  });

  it('leaves Enter on an inner control to that control', () => {
    const onClick = vi.fn();
    mount({ onClick });
    fireEvent.keyDown(screen.getByTestId('carousel-next-button'), { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps arrow keys for an editable control inside the carousel', () => {
    mount({ items: [{ id: 'a', content: <input aria-label="campo" /> }, { id: 'b', content: 'B' }] });
    fireEvent.keyDown(screen.getByLabelText('campo'), { key: 'ArrowRight' });
    expect(active()).toBe(0);
  });

  it('keeps pinch-zoom while the frame owns the horizontal drag', () => {
    mount();
    expect(cssText()).toContain('touch-action:pan-y pinch-zoom');
  });

  it('ignores a second finger and drops the gesture', () => {
    mount();
    const frame = screen.getByTestId('carousel-container');
    pointer(frame, 'pointerDown', 300, 100, 1000, { pointerId: 1, isPrimary: true });
    pointer(frame, 'pointerDown', 250, 100, 1010, { pointerId: 2, isPrimary: false });
    pointer(frame, 'pointerMove', 100, 100, 1100, { pointerId: 1, isPrimary: true });
    pointer(frame, 'pointerUp', 100, 100, 1200, { pointerId: 1, isPrimary: true });
    expect(active()).toBe(0);
  });

  it('follows only the pointer that started it', () => {
    mount();
    const frame = screen.getByTestId('carousel-container');
    pointer(frame, 'pointerDown', 300, 100, 1000, { pointerId: 1, isPrimary: true });
    pointer(frame, 'pointerMove', 100, 100, 1100, { pointerId: 2, isPrimary: true });
    pointer(frame, 'pointerUp', 100, 100, 1200, { pointerId: 2, isPrimary: true });
    expect(active()).toBe(0);
  });

  it('is quiet to a screen reader while autoplay rotates, polite otherwise', () => {
    mount({ autoPlay: true });
    expect(screen.getByTestId('carousel-track')).toHaveAttribute('aria-live', 'off');
    cleanup();
    mount();
    expect(screen.getByTestId('carousel-track')).toHaveAttribute('aria-live', 'polite');
    cleanup();
    mount({ autoPlay: true });
    fireEvent.mouseEnter(screen.getByTestId('carousel-container'));
    expect(screen.getByTestId('carousel-track')).toHaveAttribute('aria-live', 'polite');
  });

  it('does not swallow a later keyboard click after a touch drag', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    mount({ onClick });
    drag([300, 100], [100, 100]);
    act(() => {
      vi.runAllTimers();
    });
    fireEvent.click(screen.getByText('B'));
    vi.useRealTimers();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('swallows a click that arrives in a later task after a short drag, and not one after the window', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    mount({ onClick });
    const frame = screen.getByTestId('carousel-container');
    pointer(frame, 'pointerDown', 200, 100, 1000);
    pointer(frame, 'pointerMove', 212, 100, 1020);
    pointer(frame, 'pointerUp', 212, 100, 1040);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.click(screen.getByText('A'));
    expect(onClick).not.toHaveBeenCalled();

    pointer(frame, 'pointerDown', 200, 100, 2000);
    pointer(frame, 'pointerMove', 212, 100, 2020);
    pointer(frame, 'pointerUp', 212, 100, 2040);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.click(screen.getByText('A'));
    vi.useRealTimers();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps swallowing the click of a second quick drag when the first one\'s window ends', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    mount({ onClick });
    const frame = screen.getByTestId('carousel-container');
    const shortDrag = (at: number) => {
      pointer(frame, 'pointerDown', 200, 100, at);
      pointer(frame, 'pointerMove', 212, 100, at + 20);
      pointer(frame, 'pointerUp', 212, 100, at + 40);
    };

    shortDrag(1000);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    shortDrag(1250);
    act(() => {
      vi.advanceTimersByTime(70);
    });
    fireEvent.click(screen.getByText('A'));
    vi.useRealTimers();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not report a vertical mouse drag as a tap', () => {
    const onClick = vi.fn();
    mount({ onClick });
    drag([200, 100], [200, 300]);
    fireEvent.click(screen.getByText('A'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('emits the hide-on-touch rule on the next arrow only when asked', () => {
    const touchRule = (cls: string) =>
      new RegExp(`@media \\(hover: none\\) and \\(pointer: coarse\\)\\{\\.${cls}\\{[^}]*display:none`);

    mount({ hideArrowsOnTouch: true });
    expect(cssText()).toMatch(touchRule(ownClass(screen.getByTestId('carousel-next-button'))));
    cleanup();
    mount();
    expect(cssText()).not.toMatch(touchRule(ownClass(screen.getByTestId('carousel-next-button'))));
  });

  it('gives a pill button a 24 design px target and its pill no transition under reduced motion', () => {
    mount({ indicatorVariant: 'pills' });
    const button = screen.getByTestId('carousel-indicator-0');
    const side = rem(createTheme(), 24);
    const rule = cssText().match(new RegExp(`\\.${ownClass(button)}\\{([^}]*)\\}`))?.[1] ?? '';

    expect(rule).toContain(`min-width:${side}`);
    expect(rule).toContain(`height:${side}`);

    const pill = button.querySelector('span') as HTMLElement;
    const reduced = new RegExp(
      `@media \\(prefers-reduced-motion: reduce\\)\\{\\.${ownClass(pill)}\\{[^}]*transition:none`,
    );
    expect(reduced.test(cssText())).toBe(true);
  });
});
