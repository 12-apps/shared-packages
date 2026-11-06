// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { Calendar } from '../Calendar';

/**
 * The calendar's focus rings are a KEYBOARD reader's place (FUT-4156): they
 * show under `:focus-visible` only, never after a pointer tap. jsdom matches no
 * `:focus-visible`, so these read the rules Emotion emitted for the element's
 * own classes, the way the today-mark test does.
 */

const emitted = (): string => [...document.querySelectorAll('style')].map((tag) => tag.textContent ?? '').join('\n');

/** Every rule block whose selector is `.<own class><suffix>`, exactly. */
function rulesFor(element: HTMLElement, suffix: string): string[] {
  const css = emitted();
  return element.className
    .split(' ')
    .filter((name) => name.startsWith('css-'))
    .flatMap((name) => {
      const selector = `.${name}${suffix}{`;
      return css.split('}').filter((block) => block.trimStart().startsWith(selector));
    })
    .map((block) => block.slice(block.indexOf('{') + 1));
}

describe('the container ring', () => {
  it('R1: draws no outline on plain focus', () => {
    render(<Calendar ariaLabel="c" />);
    const container = screen.getByTestId('calendar-container');
    expect(rulesFor(container, '').join('')).toMatch(/outline:none/u);
    expect(rulesFor(container, ':focus').join('')).not.toMatch(/outline:[^n]/u);
  });

  it('R2: rings under :focus-visible and :has(:focus-visible) as TWO rules', () => {
    // One selector list would be dropped whole by a browser without `:has`,
    // taking the container's own keyboard ring with it.
    render(<Calendar ariaLabel="c" />);
    const container = screen.getByTestId('calendar-container');
    expect(rulesFor(container, ':focus-visible').join('')).toMatch(/outline:[\d.]+rem solid/u);
    expect(rulesFor(container, ':has(:focus-visible)').join('')).toMatch(/outline:[\d.]+rem solid/u);
  });
});

describe("a day's ring", () => {
  it('R3: is drawn on the face under :focus-visible only, and plain focus clears the outline', () => {
    render(<Calendar ariaLabel="c" value={new Date(2026, 10, 10)} />);
    const day = screen.getAllByTestId('calendar-date-12')[0]!;
    expect(rulesFor(day, ':focus').join('')).toMatch(/outline:none/u);
    expect(rulesFor(day, ':focus-visible::before').join('')).toMatch(/outline:[\d.]+rem solid/u);
    expect(rulesFor(day, '::before').join('')).not.toMatch(/outline/u);
  });
});
