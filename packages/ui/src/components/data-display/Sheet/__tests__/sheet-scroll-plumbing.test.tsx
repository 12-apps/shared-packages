/**
 * THE HALF OF THE CEILING THAT IS NOT IN `panelSx`.
 *
 * `sheet-geometry.test.ts` pins the panel's own rules — `height: auto` and a
 * `maxHeight` — and passes whether or not the panel can actually DISTRIBUTE
 * that height. It cannot on its own: a `maxHeight` with the body still asking
 * for `height: 100%` leaves the body at its content's height, and because the
 * panel is `overflow: visible` the content and the footer are then PAINTED
 * outside it, over the page. Measured in Chromium at that state: a 400px panel
 * with a scroll height of 6949px and its footer 6549px below its own bottom
 * edge.
 *
 * So the mechanism is three rules across two files, and only one of them was
 * covered. These assert the other two, on the rendered element rather than on a
 * style object, because that is what a reverted `Sheet.body.tsx` would change
 * while every geometry assertion stayed green.
 *
 * jsdom does no layout, so this cannot claim the scrolling WORKS — that is a
 * browser's answer, and Storybook holds it. What it can claim is that the rules
 * which make it possible are on the elements they have to be on, which is
 * exactly the regression that slipped through.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sheet } from '../Sheet';

/**
 * Whether a resolved length is zero, however the engine spelt it.
 *
 * jsdom returns the declaration verbatim — `'0'` where a browser resolves
 * `'0px'` — so comparing to either string alone makes the assertion a test of
 * the environment rather than of the rule.
 */
const isZero = (length: string): boolean => /^0(px|%)?$/.test(length.trim());

/** A sheet of the given position, open, with something in it. */
function open(position: 'bottom' | 'top' | 'left' | 'right'): HTMLElement {
  render(
    <Sheet open position={position} title="Where are you?" dataTestId="probe">
      <p>a line of content</p>
    </Sheet>,
  );
  return screen.getByTestId('probe');
}

describe('a vertical sheet hands its height down as a flex item', () => {
  it.each(['bottom', 'top'] as const)('makes the %s sheet body shrinkable', (position) => {
    const body = open(position);
    const style = getComputedStyle(body);

    // It FILLS what the panel has rather than asking for a percentage of it:
    // the panel's height is `auto`, so `height: 100%` resolves to `auto` too
    // and the body sizes to its content — past the ceiling, and out of the
    // panel.
    expect(style.flexGrow).toBe('1');
    expect(style.flexShrink).toBe('1');
    // The rule the whole thing turns on. A flex item's automatic minimum size
    // is its content unless this says otherwise, so without it the body cannot
    // shrink to the ceiling and nothing below it ever scrolls.
    expect(isZero(style.minHeight)).toBe(true);
    expect(style.height).not.toBe('100%');
  });

  it('leaves a side sheet on the full height it already had', () => {
    // Nothing to distribute here: MUI gives a left/right paper the full height
    // of the viewport, so the body takes all of it and this file's argument
    // does not apply.
    const style = getComputedStyle(open('right'));
    expect(style.height).toBe('100%');
    expect(isZero(style.minHeight)).toBe(false);
  });
});

describe('the content region is the thing that scrolls', () => {
  it('owns the overflow, and grows into the space the body gives it', () => {
    open('bottom');
    const style = getComputedStyle(screen.getByTestId('probe-content'));
    expect(style.overflow).toBe('auto');
    expect(style.flexGrow).toBe('1');
    // No `minHeight: 0` needed on THIS one, and asserting its absence is the
    // point: a flex item's automatic minimum size applies only while its
    // main-axis overflow is `visible`. Stating it here would be dead code, and
    // the next reader would copy it to the next scrolling region.
    expect(isZero(style.minHeight)).toBe(false);
  });
});
