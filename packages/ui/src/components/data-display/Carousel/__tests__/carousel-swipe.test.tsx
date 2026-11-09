import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Carousel } from '../Carousel';
import { PT_BR_CAROUSEL_COPY } from '../../../../pt-BR';

afterEach(cleanup);

const makeItems = () => ['a', 'b', 'c', 'd'].map((id) => ({ id, content: id.toUpperCase() }));
const active = () =>
  makeItems().findIndex((_, i) => screen.getByTestId(`carousel-slide-${i}`).getAttribute('data-active') === 'true');

/** jsdom has no PointerEvent: a MouseEvent under the pointer name carries the same coordinates. */
const pointer = (el: Element, type: string, x: number, y: number, timeStamp?: number) => {
  const event = new MouseEvent(type.toLowerCase(), {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp });
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
    const frame = screen.getByTestId('carousel-container');
    const row = screen.getByTestId('carousel-indicators');

    expect(frame.contains(row)).toBe(false);
    expect(frame.parentElement).toBe(row.parentElement);
    expect(frame.nextElementSibling).toBe(row);

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
