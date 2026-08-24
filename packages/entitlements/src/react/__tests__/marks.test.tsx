// @vitest-environment jsdom
/**
 * The regression that made this its own module.
 *
 * `<Box component="svg" width="20" height="20">` reads as a 20px mark and
 * renders one about 150px tall: `Box` is MUI's, `width`/`height` are SYSTEM
 * props, so they never reach the DOM as SVG attributes — and `'20'` is not a
 * CSS length, so the declaration they became was dropped as invalid. With no
 * attribute size and no CSS size, an inline SVG falls back to the
 * replaced-element default, and every line of every pricing card carried a
 * tick an order of magnitude larger than its own label.
 *
 * Nothing about that is visible in review — the numbers are right there in the
 * markup — so it is asserted here, on the rendered element, in both of the
 * ways it could regress: no size attribute reaching the DOM is fine, but the
 * CSS one has to be real.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IncludedMark } from '../marks';

function markOf(container: HTMLElement): SVGElement {
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error('no mark rendered');
  return svg;
}

describe('the included / excluded mark', () => {
  it('carries a real CSS size, in a unit the browser accepts', () => {
    const { container } = render(<IncludedMark included label={null} />);
    const mark = markOf(container);
    // The bug's exact signature: a bare number reaches CSS as `width: 20`,
    // which is invalid and therefore absent. Anything ending in `px` is a
    // length; an empty string is the defect.
    expect(getComputedStyle(mark).width).toMatch(/^\d+px$/);
    expect(getComputedStyle(mark).height).toMatch(/^\d+px$/);
  });

  it('draws a different glyph for included and excluded', () => {
    const { container: yes } = render(<IncludedMark included label={null} />);
    const { container: no } = render(<IncludedMark included={false} label={null} />);
    expect(markOf(yes).innerHTML).not.toBe(markOf(no).innerHTML);
  });

  it('is decoration beside a label, and readable where it is the only text', () => {
    // A card line already says what it is; announcing "included" before each
    // of them reads the list twice. A matrix cell has no other text at all.
    const { container: decorative } = render(<IncludedMark included label={null} />);
    expect(markOf(decorative).getAttribute('aria-hidden')).toBe('true');
    expect(markOf(decorative).getAttribute('aria-label')).toBeNull();

    const { container: standalone } = render(<IncludedMark included={false} label="Não incluído" />);
    expect(markOf(standalone).getAttribute('aria-hidden')).toBeNull();
    expect(markOf(standalone).getAttribute('role')).toBe('img');
    expect(markOf(standalone).getAttribute('aria-label')).toBe('Não incluído');
  });
});
